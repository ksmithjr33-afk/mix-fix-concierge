/** At the top of the event on the staff event page, the admin event page, and its Day of tab. Text from lib/partners/surprise-banner.ts. */
export default function SurpriseBanner({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <section role="alert" className="rounded-2xl border-2 border-[#5B3F7A] bg-[#EDE3F5] px-4 py-3">
      <p className="font-heading font-bold text-[#3F2A57]">{text}</p>
    </section>
  );
}
