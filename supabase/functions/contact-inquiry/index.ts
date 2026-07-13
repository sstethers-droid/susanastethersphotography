import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigins = new Set([
  "https://susanastethersphotography.com",
  "https://www.susanastethersphotography.com",
  "http://127.0.0.1:8000",
  "http://localhost:8000",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "https://susanastethersphotography.com",
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char] || char);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const origin = req.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin)) {
    return json(req, { error: "Origin not allowed" }, 403);
  }

  try {
    const input = await req.json();
    const name = String(input.name || "").trim().slice(0, 100);
    const email = String(input.email || "").trim().toLowerCase().slice(0, 200);
    const sessionType = String(input.session_type || "").trim().slice(0, 100) || null;
    const message = String(input.message || "").trim().slice(0, 2000) || null;
    const website = String(input.website || "").trim();

    // Honeypot submissions look successful but are neither stored nor emailed.
    if (website) return json(req, { ok: true });
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json(req, { error: "Please provide a valid name and email." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const resendKey = Deno.env.get("RESEND_API_KEY") || "";
    if (!supabaseUrl || !anonKey) throw new Error("Supabase configuration is missing");

    const inquiry = { name, email, session_type: sessionType, message, status: "new" };
    const saved = await fetch(`${supabaseUrl}/rest/v1/inquiries`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(inquiry),
    });
    if (!saved.ok) throw new Error(`Inquiry storage failed (${saved.status})`);

    if (!resendKey) {
      console.error("RESEND_API_KEY is not configured; inquiry was saved without notification");
      return json(req, { ok: false, saved: true, emailSent: false }, 503);
    }

    const notification = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") ||
          "Susana Stethers Website <onboarding@resend.dev>",
        to: ["susanastethersphotography@gmail.com"],
        reply_to: email,
        subject: `New ${sessionType || "photography"} inquiry from ${name}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6;color:#2f2a26;max-width:620px">
            <h1 style="font-family:Georgia,serif;font-weight:400">New website inquiry</h1>
            <p><strong>Name:</strong> ${escapeHtml(name)}<br>
            <strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a><br>
            <strong>Session:</strong> ${escapeHtml(sessionType || "Not specified")}</p>
            <p><strong>Message:</strong></p>
            <p style="white-space:pre-wrap">${escapeHtml(message || "No message included.")}</p>
            <p><small>This inquiry is also saved in your private owner portal.</small></p>
          </div>`,
      }),
    });

    if (!notification.ok) {
      const detail = await notification.text();
      console.error("Resend notification failed", notification.status, detail);
      return json(req, { ok: false, saved: true, emailSent: false }, 502);
    }

    return json(req, { ok: true, saved: true, emailSent: true });
  } catch (error) {
    console.error("Contact inquiry failed", error);
    return json(req, { error: "Unable to send inquiry" }, 500);
  }
});
