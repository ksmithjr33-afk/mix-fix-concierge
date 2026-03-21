export interface MenuDrink {
  name: string;
  ingredients: string;
  type: 'cocktail' | 'mocktail';
}

export interface MenuEventData {
  eventName: string;
  eventType: string;
  clientName: string;
  eventColors: [string, string, string];
  packageType: string;
  drinks: MenuDrink[];
  menuStyle: string;
  menuNotes: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generateClassicElegantHTML(event: MenuEventData): string {
  const primary = event.eventColors[0];
  const secondary = event.eventColors[1];
  const background = event.eventColors[2];

  const drinksHtml = event.drinks
    .map((drink, i) => {
      const badge =
        drink.type === 'mocktail'
          ? `<span style="display:inline-block;font-family:'Cormorant Garamond',serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${secondary};border:1px solid ${secondary};padding:2px 8px;margin-top:4px;">Mocktail</span><br/>`
          : '';
      const divider =
        i < event.drinks.length - 1
          ? `<div style="margin:16px 0;color:${secondary};font-size:14px;letter-spacing:8px;">&#9733; &#9733; &#9733;</div>`
          : '';
      return `
        <div style="text-align:center;margin-bottom:8px;">
          ${badge}
          <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;text-transform:uppercase;letter-spacing:4px;color:${primary};margin-bottom:4px;">
            ${escapeHtml(drink.name)}
          </div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:14px;font-style:italic;color:${secondary};margin-bottom:4px;">
            ${escapeHtml(drink.ingredients)}
          </div>
        </div>
        ${divider}`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<link href="https://fonts.googleapis.com/css2?family=Pinyon+Script&family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:${background};">
<div style="position:relative;width:500px;min-height:700px;margin:0 auto;background:${background};padding:40px;box-sizing:border-box;overflow:hidden;">
  <!-- Double border -->
  <div style="position:absolute;top:20px;right:20px;bottom:20px;left:20px;border:1px solid ${secondary};"></div>
  <div style="position:absolute;top:24px;right:24px;bottom:24px;left:24px;border:1px solid ${secondary};"></div>

  <!-- Corner flourishes -->
  <svg style="position:absolute;top:12px;left:12px;" width="40" height="40" viewBox="0 0 40 40">
    <path d="M5 35 Q5 5 35 5" fill="none" stroke="${secondary}" stroke-width="1.5"/>
    <path d="M10 30 Q10 10 30 10" fill="none" stroke="${secondary}" stroke-width="1"/>
  </svg>
  <svg style="position:absolute;top:12px;right:12px;" width="40" height="40" viewBox="0 0 40 40">
    <path d="M35 35 Q35 5 5 5" fill="none" stroke="${secondary}" stroke-width="1.5"/>
    <path d="M30 30 Q30 10 10 10" fill="none" stroke="${secondary}" stroke-width="1"/>
  </svg>
  <svg style="position:absolute;bottom:12px;left:12px;" width="40" height="40" viewBox="0 0 40 40">
    <path d="M5 5 Q5 35 35 35" fill="none" stroke="${secondary}" stroke-width="1.5"/>
    <path d="M10 10 Q10 30 30 30" fill="none" stroke="${secondary}" stroke-width="1"/>
  </svg>
  <svg style="position:absolute;bottom:12px;right:12px;" width="40" height="40" viewBox="0 0 40 40">
    <path d="M35 5 Q35 35 5 35" fill="none" stroke="${secondary}" stroke-width="1.5"/>
    <path d="M30 10 Q30 30 10 30" fill="none" stroke="${secondary}" stroke-width="1"/>
  </svg>

  <!-- Content -->
  <div style="position:relative;z-index:1;text-align:center;padding:40px 20px 20px;">
    <div style="font-family:'Pinyon Script',cursive;font-size:48px;color:${primary};margin-bottom:0;line-height:1.2;">
      Cocktail
    </div>
    <div style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:400;text-transform:uppercase;letter-spacing:10px;color:${primary};margin-bottom:8px;">
      MENU
    </div>
    <div style="font-family:'Cormorant Garamond',serif;font-size:14px;font-style:italic;color:${secondary};margin-bottom:32px;">
      ${escapeHtml(event.eventName)}
    </div>

    <div style="width:60px;height:1px;background:${secondary};margin:0 auto 32px;"></div>

    ${drinksHtml}

    <!-- Watermark -->
    <div style="margin-top:40px;font-family:'Cormorant Garamond',serif;font-size:10px;text-transform:uppercase;letter-spacing:4px;color:${secondary};opacity:0.5;">
      The Mix Fix
    </div>
  </div>
</div>
</body>
</html>`;
}

export function generateModernBoldHTML(event: MenuEventData): string {
  const primary = event.eventColors[0];
  const secondary = event.eventColors[1];
  const background = event.eventColors[2];

  const drinksHtml = event.drinks
    .map((drink, i) => {
      const num = String(i + 1).padStart(2, '0');
      const badge =
        drink.type === 'mocktail'
          ? `<span style="display:inline-block;font-family:'DM Sans',sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#ffffff;background:${secondary};padding:3px 10px;border-radius:20px;margin-top:4px;">Mocktail</span><br/>`
          : '';
      const divider =
        i < event.drinks.length - 1
          ? `<div style="margin:20px 0;text-align:center;color:${secondary};font-size:16px;letter-spacing:12px;">&#8226; &#8226; &#8226;</div>`
          : '';
      return `
        <div style="position:relative;text-align:center;margin-bottom:8px;padding:12px 0;">
          <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-family:'DM Sans',sans-serif;font-size:100px;font-weight:900;color:${primary};opacity:0.06;line-height:1;pointer-events:none;">
            ${num}
          </div>
          <div style="position:relative;z-index:1;">
            ${badge}
            <div style="font-family:'DM Sans',sans-serif;font-size:20px;font-weight:700;text-transform:uppercase;letter-spacing:3px;color:${primary};margin-bottom:6px;">
              ${escapeHtml(drink.name)}
            </div>
            <div style="font-family:'DM Sans',sans-serif;font-size:13px;font-weight:400;color:${secondary};margin-bottom:4px;">
              ${escapeHtml(drink.ingredients)}
            </div>
          </div>
        </div>
        ${divider}`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;900&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:${background};">
<div style="position:relative;width:500px;min-height:700px;margin:0 auto;background:${background};padding:40px;box-sizing:border-box;overflow:hidden;">
  <!-- Top accent bar -->
  <div style="position:absolute;top:0;left:0;right:0;height:6px;background:linear-gradient(90deg,${primary},${secondary});"></div>

  <!-- Decorative corner circles -->
  <div style="position:absolute;top:-30px;right:-30px;width:80px;height:80px;border-radius:50%;border:2px solid ${secondary};opacity:0.15;"></div>
  <div style="position:absolute;bottom:-30px;left:-30px;width:80px;height:80px;border-radius:50%;border:2px solid ${secondary};opacity:0.15;"></div>
  <div style="position:absolute;top:40px;right:40px;width:40px;height:40px;border-radius:50%;border:1px solid ${secondary};opacity:0.1;"></div>
  <div style="position:absolute;bottom:40px;left:40px;width:40px;height:40px;border-radius:50%;border:1px solid ${secondary};opacity:0.1;"></div>

  <!-- Content -->
  <div style="position:relative;z-index:1;text-align:center;padding:30px 20px 20px;">
    <div style="font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:6px;color:${secondary};margin-bottom:2px;">
      COCKTAIL
    </div>
    <div style="font-family:'DM Sans',sans-serif;font-size:36px;font-weight:900;text-transform:uppercase;letter-spacing:4px;color:${primary};margin-bottom:16px;">
      MENU
    </div>

    <!-- Event name with accent lines -->
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:32px;">
      <div style="flex:1;max-width:60px;height:1px;background:${secondary};"></div>
      <div style="font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:3px;color:${secondary};">
        ${escapeHtml(event.eventName)}
      </div>
      <div style="flex:1;max-width:60px;height:1px;background:${secondary};"></div>
    </div>

    ${drinksHtml}

    <!-- Watermark -->
    <div style="margin-top:40px;font-family:'DM Sans',sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:4px;color:${secondary};opacity:0.4;">
      The Mix Fix
    </div>
  </div>
</div>
</body>
</html>`;
}

export function getTemplatesForStyle(
  menuStyle: string
): Array<'classic' | 'modern'> {
  const style = (menuStyle || '').toLowerCase();
  const classicFirst = ['elegant', 'classic', 'romantic', 'luxe'];
  const modernFirst = ['modern', 'minimalist', 'bold', 'fun'];

  if (classicFirst.some((s) => style.includes(s))) {
    return ['classic', 'modern'];
  }
  if (modernFirst.some((s) => style.includes(s))) {
    return ['modern', 'classic'];
  }
  return ['classic', 'modern'];
}
