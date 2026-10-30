// Transactional email via Resend's REST API (no SDK). Only used for /admin magic links.

export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  // Resend's shared sender only delivers to the Resend account's own address, which is fine for a single admin.
  const from = process.env.EMAIL_FROM ?? "Crown Survivors <onboarding@resend.dev>";
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
