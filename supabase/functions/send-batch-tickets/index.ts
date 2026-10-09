import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

Deno.serve(async (req) => {

  /* =====================================================
     CORS
  ===================================================== */

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }


  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed",
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

    /* =====================================================
       ENVIRONMENT VARIABLES
    ===================================================== */

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const resendApiKey =
      Deno.env.get("RESEND_API_KEY");


    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !resendApiKey
    ) {

      throw new Error(
        "Required environment variables are missing."
      );

    }


    /* =====================================================
       AUTHORIZATION HEADER
    ===================================================== */

    const authHeader =
      req.headers.get("Authorization");


    if (!authHeader) {

      return new Response(
        JSON.stringify({
          error: "Authentication required.",
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );

    }


    /* =====================================================
       VERIFY USER SESSION
    ===================================================== */

    const userClient =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          global: {
            headers: {
              Authorization: authHeader,
            },
          },
        },
      );


    const {
      data: {
        user,
      },
      error: userError,
    } =
      await userClient.auth.getUser();


    if (
      userError ||
      !user
    ) {

      return new Response(
        JSON.stringify({
          error: "Invalid or expired session.",
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );

    }


    /* =====================================================
       ADMIN CLIENT
    ===================================================== */

    const adminClient =
      createClient(
        supabaseUrl,
        serviceRoleKey,
      );


    /* =====================================================
       VERIFY ADMIN / STAFF
    ===================================================== */

    const {
      data: admin,
      error: adminError,
    } =
      await adminClient
        .from("admins")
        .select(
          "id, email, role, page_permissions, must_change_password, is_active"
        )
        .eq(
          "id",
          user.id
        )
        .maybeSingle();


    if (
      adminError ||
      !admin || !admin.is_active || admin.must_change_password
    ) {

      return new Response(
        JSON.stringify({
          error:
            "You are not authorized to send tickets.",
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );

    }


    if (
      !["ADMIN", "STAFF"].includes(
        admin.role
      )
    ) {

      return new Response(
        JSON.stringify({
          error:
            "Only ADMIN or STAFF users can send tickets.",
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );

    }

    if (admin.role !== "ADMIN" && !admin.page_permissions?.includes("participants")) {
      return new Response(
        JSON.stringify({ error: "Your account does not have permission to send batch tickets." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }


    /* =====================================================
       READ REQUEST BODY
    ===================================================== */

    let body;

    try {

      body =
        await req.json();

    }
    catch {

      return new Response(
        JSON.stringify({
          error:
            "Invalid JSON request body.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );

    }


    const eventId =
      body.event_id;

    const batch =
      body.batch;


    if (!eventId) {

      return new Response(
        JSON.stringify({
          error:
            "event_id is required.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );

    }


    if (
      !batch ||
      String(batch).trim() === ""
    ) {

      return new Response(
        JSON.stringify({
          error:
            "batch is required.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );

    }


    const selectedBatch =
      String(batch).trim();


    /* =====================================================
       GET EVENT
    ===================================================== */

    const {
      data: event,
      error: eventError,
    } =
      await adminClient
        .from("events")
        .select(`
          id,
          event_name,
          event_code,
          event_date,
          event_time,
          venue,
          logo_url
        `)
        .eq(
          "id",
          eventId
        )
        .maybeSingle();


    if (
      eventError ||
      !event
    ) {

      return new Response(
        JSON.stringify({
          error:
            "Event not found.",
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );

    }


    /* =====================================================
       GET PARTICIPANTS FOR SELECTED BATCH
    ===================================================== */

    const {
      data: participantData,
      error: participantError,
    } =
      await adminClient
        .from("participants")
        .select(`
          id,
          full_name,
          email,
          phone,
          registration_no,
          batch,
          gender,
          meal
        `)
        .eq(
          "event_id",
          eventId
        )
        .eq(
          "batch",
          selectedBatch
        );


    if (participantError) {

      console.error(
        participantError
      );

      return new Response(
        JSON.stringify({
          error:
            "Unable to retrieve participants.",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );

    }


    const participants =
      participantData || [];


    if (
      participants.length === 0
    ) {

      return new Response(
        JSON.stringify({
          message:
            "No participants found for this batch.",
          event_id: eventId,
          batch: selectedBatch,
          total: 0,
          attempted: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );

    }


    /* =====================================================
       GET TICKETS
    ===================================================== */

    const participantIds =
      participants.map(
        participant =>
          participant.id
      );


    const {
      data: ticketData,
      error: ticketError,
    } =
      await adminClient
        .from("tickets")
        .select(`
          id,
          participant_id,
          ticket_id,
          qr_data,
          ticket_status,
          email_status
        `)
        .in(
          "participant_id",
          participantIds
        );


    if (ticketError) {

      console.error(
        ticketError
      );

      return new Response(
        JSON.stringify({
          error:
            "Unable to retrieve tickets.",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );

    }


    const tickets =
      ticketData || [];


    /* =====================================================
       CREATE TICKET LOOKUP
    ===================================================== */

    const ticketMap =
      new Map();


    tickets.forEach(
      ticket => {

        ticketMap.set(
          ticket.participant_id,
          ticket
        );

      }
    );


    /* =====================================================
       RESULTS
    ===================================================== */

    let attempted = 0;

    let sent = 0;

    let failed = 0;

    let skipped = 0;


    const results = [];


    /* =====================================================
       PROCESS EACH PARTICIPANT
    ===================================================== */

    for (
      const participant of participants
    ) {

      const ticket =
        ticketMap.get(
          participant.id
        );


      /* ---------------------------------------------------
         NO TICKET
      --------------------------------------------------- */

      if (!ticket) {

        skipped++;

        results.push({
          participant_id:
            participant.id,
          name:
            participant.full_name,
          email:
            participant.email,
          status:
            "SKIPPED",
          reason:
            "No ticket found.",
        });

        continue;

      }


      /* ---------------------------------------------------
         ALREADY SENT
      --------------------------------------------------- */

      if (
        ticket.email_status === "SENT"
      ) {

        skipped++;

        results.push({
          participant_id:
            participant.id,
          ticket_id:
            ticket.ticket_id,
          name:
            participant.full_name,
          email:
            participant.email,
          status:
            "SKIPPED",
          reason:
            "Email already sent.",
        });

        continue;

      }


      /* ---------------------------------------------------
         MISSING EMAIL
      --------------------------------------------------- */

      if (
        !participant.email ||
        String(
          participant.email
        ).trim() === ""
      ) {

        failed++;

        await adminClient
          .from("tickets")
          .update({
            email_status:
              "FAILED",
          })
          .eq(
            "id",
            ticket.id
          );


        results.push({
          participant_id:
            participant.id,
          ticket_id:
            ticket.ticket_id,
          name:
            participant.full_name,
          email:
            null,
          status:
            "FAILED",
          reason:
            "Participant email address is missing.",
        });

        continue;

      }


      /* ---------------------------------------------------
         ATTEMPT EMAIL
      --------------------------------------------------- */

      attempted++;


      try {

        /*
          QR code contains ONLY the ticket ID.
        */

        const qrData =
          encodeURIComponent(
            ticket.qr_data ||
            ticket.ticket_id
          );


        const qrUrl =
          `https://quickchart.io/qr?text=${qrData}&size=300&margin=2`;


        /* =================================================
           HTML EMAIL
        ================================================= */

        const html = `

<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<title>
${escapeHtml(event.event_name)}
</title>

</head>


<body style="
  margin:0;
  padding:0;
  background:#f4f6f9;
  font-family:Arial,Helvetica,sans-serif;
">


<table
  width="100%"
  cellpadding="0"
  cellspacing="0"
  style="background:#f4f6f9;padding:30px 10px;"
>

<tr>

<td align="center">


<table
  width="600"
  cellpadding="0"
  cellspacing="0"
  style="
    max-width:600px;
    background:#ffffff;
    border-radius:12px;
    overflow:hidden;
    box-shadow:0 4px 18px rgba(0,0,0,0.08);
  "
>


<!-- HEADER -->

<tr>

<td
  align="center"
  style="
    padding:25px;
    background:#111827;
  "
>

${
  event.logo_url
    ? `
      <img
        src="${escapeHtml(event.logo_url)}"
        alt="SABSA"
        style="
          width:80px;
          height:80px;
          object-fit:contain;
          background:#ffffff;
          border-radius:50%;
          padding:8px;
          margin-bottom:12px;
        "
      >
    `
    : ""
}

<div style="
  color:#ffffff;
  font-size:24px;
  font-weight:bold;
">

${escapeHtml(
  event.event_name
)}

</div>

<div style="
  color:#d1d5db;
  font-size:13px;
  margin-top:6px;
">

Electronic Event Ticket

</div>

</td>

</tr>


<!-- BODY -->

<tr>

<td style="padding:30px;">


<p style="
  margin:0 0 20px 0;
  font-size:16px;
  color:#111827;
">

Dear
<strong>
${escapeHtml(
  participant.full_name
)}
</strong>,

</p>


<p style="
  color:#4b5563;
  font-size:14px;
  line-height:1.6;
">

Thank you for registering for
<strong>
${escapeHtml(
  event.event_name
)}
</strong>.

Please present the QR code below at the event entrance.

</p>


<!-- TICKET DETAILS -->

<table
  width="100%"
  cellpadding="8"
  cellspacing="0"
  style="
    margin-top:20px;
    border:1px solid #e5e7eb;
    border-radius:8px;
  "
>

<tr>

<td style="
  color:#6b7280;
  font-size:13px;
">
Name
</td>

<td style="
  text-align:right;
  font-weight:bold;
  font-size:13px;
">
${escapeHtml(
  participant.full_name
)}
</td>

</tr>


<tr>

<td style="
  color:#6b7280;
  font-size:13px;
">
Registration No.
</td>

<td style="
  text-align:right;
  font-weight:bold;
  font-size:13px;
">
${escapeHtml(
  participant.registration_no ||
  "-"
)}
</td>

</tr>


<tr>

<td style="
  color:#6b7280;
  font-size:13px;
">
Batch
</td>

<td style="
  text-align:right;
  font-weight:bold;
  font-size:13px;
">
${escapeHtml(
  participant.batch ||
  "-"
)}
</td>

</tr>


<tr>

<td style="
  color:#6b7280;
  font-size:13px;
">
Meal
</td>

<td style="
  text-align:right;
  font-weight:bold;
  font-size:13px;
">
${escapeHtml(
  participant.meal ||
  "-"
)}
</td>

</tr>

</table>


<!-- EVENT DETAILS -->

<div style="
  margin-top:25px;
  padding:18px;
  background:#f9fafb;
  border-radius:8px;
">

<div style="
  font-size:15px;
  font-weight:bold;
  color:#111827;
  margin-bottom:10px;
">

Event Details

</div>


<div style="
  font-size:13px;
  color:#4b5563;
  line-height:1.8;
">

<strong>Date:</strong>
${escapeHtml(
  event.event_date ||
  "-"
)}

<br>

<strong>Time:</strong>
${escapeHtml(
  event.event_time ||
  "-"
)}

<br>

<strong>Venue:</strong>
${escapeHtml(
  event.venue ||
  "-"
)}

</div>

</div>


<!-- QR CODE -->

<div style="
  text-align:center;
  margin-top:30px;
">

<div style="
  font-size:14px;
  font-weight:bold;
  color:#111827;
  margin-bottom:12px;
">

Your QR Ticket

</div>


<img
  src="${qrUrl}"
  alt="QR Code"
  width="240"
  height="240"
  style="
    display:block;
    margin:0 auto;
  "
>


<div style="
  margin-top:15px;
  font-size:13px;
  color:#6b7280;
">

Ticket ID

</div>


<div style="
  margin-top:5px;
  font-size:18px;
  font-weight:bold;
  letter-spacing:1px;
  color:#111827;
">

${escapeHtml(
  ticket.ticket_id
)}

</div>

</div>


<!-- NOTICE -->

<div style="
  margin-top:25px;
  padding:15px;
  background:#eff6ff;
  border-left:4px solid #2563eb;
  color:#1e3a8a;
  font-size:12px;
  line-height:1.6;
">

Please keep this email available on your mobile device
and present the QR code when requested at the entrance.

</div>


</td>

</tr>


<!-- FOOTER -->

<tr>

<td
  align="center"
  style="
    padding:20px;
    background:#f9fafb;
    border-top:1px solid #e5e7eb;
  "
>

<div style="
  font-size:12px;
  color:#6b7280;
">

SAB Students' Association

</div>


<div style="
  font-size:11px;
  color:#9ca3af;
  margin-top:5px;
">

This is an automatically generated electronic ticket.

</div>

</td>

</tr>


</table>

</td>

</tr>

</table>

</body>

</html>

`;


        /* =================================================
           SEND THROUGH RESEND
        ================================================= */

        const resendResponse =
          await fetch(
            "https://api.resend.com/emails",
            {
              method: "POST",

              headers: {
                "Authorization":
                  `Bearer ${resendApiKey}`,

                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({

                from:
                  "SABSA E-Tickets <onboarding@resend.dev>",

                to: [
                  participant.email
                ],

                subject:
                  `${event.event_name} - Your Electronic Ticket`,

                html: html,

              }),
            },
          );


        const resendResult =
          await resendResponse.json();


        /* -------------------------------------------------
           RESEND FAILURE
        ------------------------------------------------- */

        if (
          !resendResponse.ok
        ) {

          console.error(
            "Resend error:",
            resendResult
          );


          await adminClient
            .from("tickets")
            .update({
              email_status:
                "FAILED",
            })
            .eq(
              "id",
              ticket.id
            );


          failed++;


          results.push({
            participant_id:
              participant.id,
            ticket_id:
              ticket.ticket_id,
            name:
              participant.full_name,
            email:
              participant.email,
            status:
              "FAILED",
            reason:
              resendResult.message ||
              "Resend API error.",
          });


          continue;

        }


        /* -------------------------------------------------
           SUCCESS
        ------------------------------------------------- */

        await adminClient
          .from("tickets")
          .update({
            email_status:
              "SENT",
          })
          .eq(
            "id",
            ticket.id
          );


        sent++;


        results.push({
          participant_id:
            participant.id,
          ticket_id:
            ticket.ticket_id,
          name:
            participant.full_name,
          email:
            participant.email,
          status:
            "SENT",
          resend_id:
            resendResult.id ||
            null,
        });


      }
      catch (emailError) {

        console.error(
          "Email processing error:",
          emailError
        );


        await adminClient
          .from("tickets")
          .update({
            email_status:
              "FAILED",
          })
          .eq(
            "id",
            ticket.id
          );


        failed++;


        results.push({
          participant_id:
            participant.id,
          ticket_id:
            ticket.ticket_id,
          name:
            participant.full_name,
          email:
            participant.email,
          status:
            "FAILED",
          reason:
            emailError.message ||
            "Unexpected email error.",
        });

      }

    }


    /* =====================================================
       FINAL RESPONSE
    ===================================================== */

    return new Response(
      JSON.stringify({

        success:
          failed === 0,

        message:
          "Batch email processing completed.",

        event_id:
          event.id,

        event_name:
          event.event_name,

        batch:
          selectedBatch,

        total:
          participants.length,

        attempted:
          attempted,

        sent:
          sent,

        failed:
          failed,

        skipped:
          skipped,

        sent_by:
          {
            id:
              admin.id,
            email:
              admin.email,
            role:
              admin.role,
          },

        results:
          results,

      }),
      {
        status: 200,

        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },

      },
    );


  }
  catch (error) {

    console.error(
      "Fatal function error:",
      error
    );


    return new Response(
      JSON.stringify({
        error:
          error.message ||
          "Internal server error.",
      }),
      {
        status: 500,

        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },

      },
    );

  }

});


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(
  value: unknown
): string {

  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );

}

