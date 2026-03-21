import { NextRequest, NextResponse } from "next/server";
import {
  generateClassicElegantHTML,
  generateModernBoldHTML,
  getTemplatesForStyle,
  MenuEventData,
} from "@/lib/menu-templates";

export async function POST(request: NextRequest) {
  try {
    const eventData: MenuEventData = await request.json();

    if (!eventData.drinks || eventData.drinks.length === 0) {
      return NextResponse.json(
        { error: "At least one drink is required" },
        { status: 400 }
      );
    }

    if (!eventData.eventColors || eventData.eventColors.length < 1) {
      return NextResponse.json(
        { error: "At least one event color is required" },
        { status: 400 }
      );
    }

    const classicHtml = generateClassicElegantHTML(eventData);
    const modernHtml = generateModernBoldHTML(eventData);

    const templateOrder = getTemplatesForStyle(eventData.menuStyle);

    const templateMap: Record<string, { label: string; html: string }> = {
      classic: { label: "Classic Elegant", html: classicHtml },
      modern: { label: "Modern Bold", html: modernHtml },
    };

    const menus = templateOrder.map((template) => ({
      template,
      label: templateMap[template].label,
      html: templateMap[template].html,
    }));

    // Send to GHL webhook (non-blocking, don't fail if it errors)
    const webhookUrl = process.env.GHL_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const drinksString = eventData.drinks
          .map((d) => `${d.name} (${d.type})`)
          .join(", ");

        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            menu_generation: true,
            client_name: eventData.clientName,
            event_name: eventData.eventName,
            event_type: eventData.eventType,
            package_type: eventData.packageType,
            menu_style: eventData.menuStyle,
            menu_notes: eventData.menuNotes,
            drinks: drinksString,
            event_colors: eventData.eventColors.join(", "),
            menu_option_1_template: menus[0].template,
            menu_option_2_template: menus[1].template,
          }),
        });
      } catch (webhookError) {
        console.error("GHL webhook failed:", webhookError);
      }
    }

    return NextResponse.json({ success: true, menus });
  } catch (error) {
    console.error("Menu generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate menu" },
      { status: 500 }
    );
  }
}
