import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Only POST requests are allowed.",
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  try {
    const body = await req.json();

    const ticketId = body.ticket_id?.trim();

    if (!ticketId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "ticket_id is required.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Supabase server client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase environment variables are missing.");
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
    );

    const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      return new Response(JSON.stringify({ success: false, error: "Sign in is required." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ success: false, error: "Your session is invalid or expired." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: admin, error: adminError } = await supabase.from("admins")
      .select("role,is_active,must_change_password,page_permissions")
      .eq("id", authData.user.id).maybeSingle();
    if (adminError || !admin || !admin.is_active || admin.must_change_password ||
      (admin.role !== "ADMIN" &&
        !(admin.page_permissions || []).some((page: string) =>
          ["dashboard", "participants", "tickets", "scanner"].includes(page)
        ))) {
      return new Response(JSON.stringify({ success: false, error: "You are not authorized to view ticket data." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------------------------------------------------------
    // Get ticket + participant + event
    // ---------------------------------------------------------

    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .select(`
        id,
        ticket_id,
        qr_data,
        ticket_status,
        email_status,
        created_at,
        participant:participants (
          id,
          full_name,
          email,
          phone,
          registration_no,
          batch,
          gender,
          meal,
          event:events (
            id,
            event_name,
            event_code,
            event_date,
            event_time,
            venue,
            description,
            logo_url,
            registration_open,
            scanner_enabled
          )
        )
      `)
      .eq("ticket_id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Ticket not found.",
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const participant = ticket.participant;
    const event = participant?.event;

    if (!participant || !event) {
      throw new Error(
        "Ticket is missing participant or event information.",
      );
    }

    // ---------------------------------------------------------
    // QR CODE
    // ---------------------------------------------------------
    //
    // IMPORTANT:
    // QR contains ONLY the Ticket ID.
    //
    // Example:
    // TEST26-RXHJCL
    //
    // No personal information is stored inside the QR.
    //

    const qrData = ticket.qr_data || ticket.ticket_id;

    const qrCodeUrl =
      `https://quickchart.io/qr?text=${encodeURIComponent(qrData)}&size=400&margin=2`;

    // ---------------------------------------------------------
    // Format date
    // ---------------------------------------------------------

    let formattedDate = event.event_date || "";

    if (event.event_date) {
      try {
        const date = new Date(event.event_date + "T00:00:00");

        formattedDate = date.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        });
      } catch {
        formattedDate = event.event_date;
      }
    }

    // ---------------------------------------------------------
    // Logo
    // ---------------------------------------------------------

    const logoHtml = event.logo_url
      ? `
        <img
          src="${escapeHtml(event.logo_url)}"
          alt="SABSA Logo"
          class="logo"
        />
      `
      : `
        <div class="logo-placeholder">
          SABSA
        </div>
      `;

    // ---------------------------------------------------------
    // Ticket HTML
    // ---------------------------------------------------------

    const ticketHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>${escapeHtml(event.event_name)} - E-Ticket</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 30px;
  background: #f1f3f6;
  font-family:
    Arial,
    Helvetica,
    sans-serif;
  color: #1f2937;
}

.ticket {
  width: 900px;
  max-width: 100%;
  margin: auto;
  background: white;
  border-radius: 24px;
  overflow: hidden;
  box-shadow:
    0 15px 45px rgba(0, 0, 0, 0.12);
}

/* ----------------------------------
   HEADER
---------------------------------- */

.header {
  padding: 32px 40px;
  text-align: center;
  background: linear-gradient(
    135deg,
    #111827,
    #374151
  );
  color: white;
}

.logo {
  max-width: 190px;
  max-height: 90px;
  object-fit: contain;
  margin-bottom: 18px;
}

.logo-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 150px;
  height: 70px;
  margin-bottom: 15px;
  border-radius: 12px;
  background: white;
  color: #111827;
  font-weight: bold;
  font-size: 22px;
}

.event-name {
  margin: 0;
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
}

.ticket-label {
  margin-top: 8px;
  font-size: 14px;
  letter-spacing: 3px;
  text-transform: uppercase;
  opacity: 0.85;
}

/* ----------------------------------
   BODY
---------------------------------- */

.content {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 35px;
  padding: 40px;
}

.section-title {
  margin: 0 0 22px;
  font-size: 13px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: #6b7280;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 22px;
}

.info-item {
  padding-bottom: 14px;
  border-bottom: 1px solid #e5e7eb;
}

.info-label {
  margin-bottom: 5px;
  font-size: 12px;
  color: #6b7280;
  text-transform: uppercase;
}

.info-value {
  font-size: 17px;
  font-weight: 600;
  color: #111827;
  word-break: break-word;
}

/* ----------------------------------
   EVENT INFORMATION
---------------------------------- */

.event-box {
  margin-top: 35px;
}

.event-info {
  display: grid;
  gap: 14px;
}

.event-row {
  display: flex;
  gap: 15px;
  align-items: flex-start;
}

.event-icon {
  width: 30px;
  font-size: 18px;
}

.event-text {
  font-size: 15px;
  line-height: 1.4;
}

/* ----------------------------------
   QR
---------------------------------- */

.qr-section {
  text-align: center;
  padding-left: 25px;
  border-left: 1px dashed #d1d5db;
}

.qr-image {
  width: 220px;
  height: 220px;
  max-width: 100%;
  object-fit: contain;
}

.scan-text {
  margin-top: 14px;
  font-size: 13px;
  color: #6b7280;
  line-height: 1.4;
}

.ticket-id {
  margin-top: 20px;
  padding: 12px;
  border-radius: 10px;
  background: #f3f4f6;
  font-family: monospace;
  font-size: 15px;
  font-weight: bold;
  letter-spacing: 1px;
}

/* ----------------------------------
   FOOTER
---------------------------------- */

.footer {
  padding: 20px 40px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  text-align: center;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

/* ----------------------------------
   MOBILE
---------------------------------- */

@media (max-width: 700px) {

  body {
    padding: 10px;
  }

  .content {
    grid-template-columns: 1fr;
    padding: 25px;
  }

  .qr-section {
    border-left: none;
    border-top: 1px dashed #d1d5db;
    padding-left: 0;
    padding-top: 30px;
  }

  .info-grid {
    grid-template-columns: 1fr;
  }

  .event-name {
    font-size: 24px;
  }

}

</style>

</head>

<body>

<div class="ticket">

  <!-- HEADER -->

  <div class="header">

    ${logoHtml}

    <h1 class="event-name">
      ${escapeHtml(event.event_name)}
    </h1>

    <div class="ticket-label">
      Electronic Event Ticket
    </div>

  </div>


  <!-- CONTENT -->

  <div class="content">

    <div>

      <div class="section-title">
        Attendee Information
      </div>

      <div class="info-grid">

        <div class="info-item">

          <div class="info-label">
            Name
          </div>

          <div class="info-value">
            ${escapeHtml(participant.full_name)}
          </div>

        </div>


        <div class="info-item">

          <div class="info-label">
            Registration No.
          </div>

          <div class="info-value">
            ${escapeHtml(participant.registration_no)}
          </div>

        </div>


        <div class="info-item">

          <div class="info-label">
            Batch
          </div>

          <div class="info-value">
            ${escapeHtml(participant.batch || "-")}
          </div>

        </div>


        <div class="info-item">

          <div class="info-label">
            Meal
          </div>

          <div class="info-value">
            ${escapeHtml(participant.meal || "-")}
          </div>

        </div>

      </div>


      <!-- EVENT -->

      <div class="event-box">

        <div class="section-title">
          Event Information
        </div>

        <div class="event-info">

          <div class="event-row">

            <div class="event-icon">
              📅
            </div>

            <div class="event-text">
              <strong>Date</strong><br>
              ${escapeHtml(formattedDate)}
            </div>

          </div>


          <div class="event-row">

            <div class="event-icon">
              🕐
            </div>

            <div class="event-text">
              <strong>Time</strong><br>
              ${escapeHtml(event.event_time || "-")}
            </div>

          </div>


          <div class="event-row">

            <div class="event-icon">
              📍
            </div>

            <div class="event-text">
              <strong>Venue</strong><br>
              ${escapeHtml(event.venue || "-")}
            </div>

          </div>

        </div>

      </div>

    </div>


    <!-- QR -->

    <div class="qr-section">

      <div class="section-title">
        Entry QR Code
      </div>

      <img
        src="${qrCodeUrl}"
        alt="Ticket QR Code"
        class="qr-image"
      />

      <div class="scan-text">
        Present this QR code<br>
        at the entrance.
      </div>

      <div class="ticket-id">
        ${escapeHtml(ticket.ticket_id)}
      </div>

    </div>

  </div>


  <!-- FOOTER -->

  <div class="footer">

    This is an electronic ticket issued by SAB Students' Association.
    <br>

    Please keep this ticket available when entering the event.

  </div>

</div>

</body>
</html>
`;

    // ---------------------------------------------------------
    // Return result
    // ---------------------------------------------------------

    return new Response(
      JSON.stringify({
        success: true,

        ticket: {
          id: ticket.id,
          ticket_id: ticket.ticket_id,
          qr_data: qrData,
          ticket_status: ticket.ticket_status,
          email_status: ticket.email_status,
        },

        participant: {
          id: participant.id,
          full_name: participant.full_name,
          email: participant.email,
          registration_no: participant.registration_no,
          batch: participant.batch,
        },

        event: {
          id: event.id,
          event_name: event.event_name,
          event_code: event.event_code,
          event_date: event.event_date,
          event_time: event.event_time,
          venue: event.venue,
          logo_url: event.logo_url,
        },

        qr_code_url: qrCodeUrl,

        html: ticketHtml,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );

  } catch (error) {

    console.error("Generate ticket error:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error
          ? error.message
          : "Unexpected server error.",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});


// ---------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------

function escapeHtml(value: unknown): string {

  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

