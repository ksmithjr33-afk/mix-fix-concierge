"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatContent />
    </Suspense>
  );
}

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [started, setStarted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hiddenPrefixRef = useRef<Message[]>([]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!started) {
      setStarted(true);

      const initialMessages: Message[] = [];

      // Build context message from URL query parameters
      const name = searchParams.get("name");
      const email = searchParams.get("email");
      const eventDate = searchParams.get("event_date");
      const packageType = searchParams.get("package_type");
      const guestCount = searchParams.get("guest_count");
      const eventName = searchParams.get("event_name");
      const hoursBooked = searchParams.get("hours_booked");

      if (name || email || eventDate || packageType || guestCount || eventName || hoursBooked) {
        const parts: string[] = [];
        if (name) parts.push(`Client name: ${name}`);
        if (email) parts.push(`Email: ${email}`);
        if (eventDate) parts.push(`Event date: ${eventDate}`);
        if (packageType) parts.push(`Package: ${packageType}`);
        if (guestCount) parts.push(`Guest count: ${guestCount}`);
        if (eventName) parts.push(`Event type: ${eventName}`);
        if (hoursBooked) parts.push(`Hours of bar service booked: ${hoursBooked}`);

        const contextMsg: Message = {
          role: "user",
          content: `CONTEXT - Pre-filled from booking system: ${parts.join(", ")}. Use this info and do not re-ask for it.`,
        };
        hiddenPrefixRef.current = [contextMsg];
        initialMessages.push(contextMsg);
      }

      const greeting: Message = {
        role: "user",
        content:
          "Hey! I just booked with The Mix Fix and I am ready to plan my bar service.",
      };
      initialMessages.push(greeting);

      streamResponse(initialMessages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const streamResponse = async (currentMessages: Message[]) => {
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: currentMessages }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                console.error("Stream error:", parsed.error);
                continue;
              }
              fullText += parsed.text;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: fullText,
                };
                return updated;
              });
            } catch {
              // skip malformed JSON
            }
          }
        }
      }

      // Check for EVENT_DATA_JSON
      const jsonMarker = "EVENT_DATA_JSON:";
      const jsonIndex = fullText.indexOf(jsonMarker);
      if (jsonIndex !== -1) {
        const closingMessage = fullText.slice(0, jsonIndex).trim();
        const jsonStr = fullText.slice(jsonIndex + jsonMarker.length).trim();

        // Update the displayed message to hide the JSON
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: closingMessage,
          };
          return updated;
        });

        try {
          const eventData = JSON.parse(jsonStr);
          localStorage.setItem(
            "mixfix_event_data",
            JSON.stringify(eventData)
          );

          // Build conversation transcript from all messages including final response
          const allMessages = [
            ...hiddenPrefixRef.current,
            ...currentMessages,
            { role: "assistant" as const, content: closingMessage },
          ];
          const transcript = allMessages
            .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
            .join("\n\n");

          // Save event data to Supabase
          fetch("/api/save-event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventData,
              shoppingList: null,
              shoppingListText: null,
              conversationTranscript: transcript,
            }),
          }).catch((err) => console.error("Failed to save event to Supabase:", err));

          // Brief delay so user can read the closing message
          setTimeout(() => {
            router.push("/complete");
          }, 3000);
        } catch (e) {
          console.warn("Could not parse event data JSON (may be incomplete):", e);
        }
      }
    } catch (error) {
      console.error("Fetch error:", error);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMessage: Message = { role: "user", content: text };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // Prepend hidden context messages for the API call
    await streamResponse([...hiddenPrefixRef.current, ...newMessages]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = () => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height =
        Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  };

  const handleStartOver = () => {
    if (
      window.confirm(
        "Are you sure? This will restart the conversation."
      )
    ) {
      window.location.reload();
    }
  };

  return (
    <div className="flex flex-col h-dvh bg-[#E8DDD5]">
      {/* Header */}
      <header className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 bg-[#F5F0EB] border-b border-[#DDD5CC]">
        <div className="flex items-center gap-2 sm:gap-3">
          <img
            src="/logo.png"
            alt="The Mix Fix"
            className="h-8 sm:h-10"
          />
          <span className="text-xs text-[#A39585] hidden sm:inline">
            AI Bar Concierge
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={handleStartOver}
            className="text-xs text-[#6B5D52] hover:text-[#B5845A] transition-colors px-2 py-1 rounded-lg hover:bg-[#E8DDD5]"
          >
            Start Over
          </button>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${isStreaming ? "bg-[#B5845A] animate-pulse" : "bg-[#8B9E7E]"}`}
            />
            <span className="text-xs text-[#6B5D52] hidden sm:inline">
              {isStreaming ? "Thinking..." : "Online"}
            </span>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 sm:py-6 space-y-3 sm:space-y-4">
        {messages
          .filter((msg) => msg.content.length > 0)
          .map((msg, i, filtered) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[88%] sm:max-w-[75%] px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-2xl text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
                  msg.role === "user"
                    ? "bg-[#B5845A] text-white rounded-br-md"
                    : "bg-[#F5F0EB] text-[#2C2420] border border-[#DDD5CC] rounded-bl-md"
                }`}
              >
                {msg.content}
                {msg.role === "assistant" &&
                  i === filtered.length - 1 &&
                  isStreaming && (
                    <span className="inline-block w-1.5 h-4 bg-[#B5845A] ml-1 animate-pulse rounded-sm align-text-bottom" />
                  )}
              </div>
            </div>
          ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[#DDD5CC] bg-[#F5F0EB] px-3 sm:px-4 py-2.5 sm:py-3 pb-[env(safe-area-inset-bottom,0.625rem)]">
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleTextareaInput}
            placeholder="Type your message..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3.5 sm:px-4 py-2.5 sm:py-3 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]"
            disabled={isStreaming}
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="flex items-center justify-center w-11 h-11 rounded-xl bg-[#B5845A] text-white disabled:opacity-40 hover:bg-[#9A7049] transition-colors shrink-0"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 2L11 13" />
              <path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
