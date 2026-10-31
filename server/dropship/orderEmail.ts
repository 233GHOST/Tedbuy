// Branded emails for pay-on-delivery orders: one layout, three messages. Inline CSS and table
// layout so Gmail, Outlook and phone mail apps show it the same; no images, so it reads fine
// with images blocked. Every interpolated value is escaped. A plain-text version goes with it.

export type OrderEmailKind = 'confirm' | 'new_order' | 'on_its_way';
export interface OrderEmailInput {
  kind: OrderEmailKind; orderNumber: string; title: string; quantity: number;
  totalPesewas: number; link: string; area?: string; code?: string;
}

const NAVY = '#0f172a';
const ORANGE = '#ea580c';
const SAFETY = 'Pay only when you receive your order. Never send money before delivery.';
const CODE_WARNING = 'Give this code to the seller only when the item is in your hands and you have checked it. It is not a payment.';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function money(pesewas: number): string {
  return `GH₵${(pesewas / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Content { subject: string; heading: string; intro: string; button: string; extraRows?: Array<[string, string]> }

function content(i: OrderEmailInput): Content {
  switch (i.kind) {
    case 'confirm':
      return { subject: `Please confirm your TedBuy order ${i.orderNumber}`, heading: 'Please confirm your order',
        intro: 'Thanks for your order. The seller starts only after you confirm it. If you did not place this order, ignore this email and it will be cancelled automatically.',
        button: 'View your order' };
    case 'new_order':
      return { subject: `New order ${i.orderNumber}: ${i.title}`, heading: 'You have a new order',
        intro: 'The buyer has confirmed this order. Call the buyer, then accept the order in your Orders tab.',
        button: 'Open your orders', extraRows: i.area ? [['Deliver to', i.area]] : [] };
    case 'on_its_way':
      return { subject: `Your TedBuy order ${i.orderNumber} is on its way`, heading: 'Your order is on its way',
        intro: 'The seller is bringing your order. Keep your delivery code ready.', button: 'View your order' };
  }
}

export function renderOrderEmail(i: OrderEmailInput): { subject: string; text: string; html: string } {
  const c = content(i);
  const rows: Array<[string, string]> = [
    ['Order', i.orderNumber], ['Item', i.title], ['Quantity', String(i.quantity)],
    ['Total to pay on delivery', money(i.totalPesewas)], ...(c.extraRows ?? []),
  ];

  const text = [
    c.heading, '', c.intro, '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '',
    ...(i.code ? [`Your delivery code: ${i.code}`, CODE_WARNING, ''] : []),
    SAFETY, '', `${c.button}: ${i.link}`, '', 'TedBuy · support@tedbuy.store',
  ].join('\n');

  const rowHtml = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 0;color:#64748b;font-size:13px">${esc(k)}</td>`
    + `<td style="padding:6px 0;color:${NAVY};font-size:13px;font-weight:700;text-align:right">${esc(v)}</td></tr>`).join('');
  const codeHtml = i.code
    ? `<tr><td style="padding:8px 24px 0"><div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:12px;padding:16px;text-align:center">`
      + `<div style="font-size:12px;color:#065f46;font-weight:700">Your delivery code</div>`
      + `<div style="font-family:Courier New,monospace;font-size:32px;letter-spacing:8px;font-weight:700;color:${NAVY};margin:8px 0">${esc(i.code)}</div>`
      + `<div style="font-size:12px;color:#065f46">${esc(CODE_WARNING)}</div></div></td></tr>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:${NAVY};padding:18px 24px;font-size:22px;font-weight:800"><span style="color:#ffffff">Ted</span><span style="color:${ORANGE}">Buy</span></td></tr>
<tr><td style="padding:24px 24px 8px"><h1 style="margin:0 0 8px;font-size:20px;color:${NAVY}">${esc(c.heading)}</h1>
<p style="margin:0;font-size:14px;line-height:1.5;color:#334155">${esc(c.intro)}</p></td></tr>
<tr><td style="padding:8px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">${rowHtml}</table></td></tr>
${codeHtml}
<tr><td style="padding:16px 24px 0"><p style="margin:0;font-size:13px;font-weight:700;color:#047857">${esc(SAFETY)}</p></td></tr>
<tr><td style="padding:20px 24px 24px"><a href="${esc(i.link)}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px">${esc(c.button)}</a></td></tr>
<tr><td style="padding:16px 24px;background:#f8fafc;font-size:12px;color:#64748b">TedBuy · <a href="mailto:support@tedbuy.store" style="color:#64748b">support@tedbuy.store</a></td></tr>
</table></td></tr></table></body></html>`;

  return { subject: c.subject, text, html };
}
