import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

Deno.serve(async (req) => {

  // =========================================================
  // CORS
  // =========================================================

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }


  // =========================================================
  // POST ONLY
  // =========================================================

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

    // =======================================================
    // ENVIRONMENT VARIABLES
    // =======================================================

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      );

    const resendApiKey =
      Deno.env.get(
        "RESEND_API_KEY",
      );


    if (!supabaseUrl) {
      throw new Error(
        "SUPABASE_URL is missing.",
      );
    }


    if (!serviceRoleKey) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is missing.",
      );
    }


    if (!resendApiKey) {
      throw new Error(
        "RESEND_API_KEY is missing.",
      );
    }


    // =======================================================
    // AUTHENTICATION
    // =======================================================

    const authorization =
      req.headers.get(
        "Authorization",
      );


    if (!authorization) {

      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Authentication required.",
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


    // =======================================================
    // CREATE CLIENT USING USER JWT
    // =======================================================

    const userClient =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          global: {
            headers: {
              Authorization:
                authorization,
            },
          },
        },
      );


    // =======================================================
    // GET AUTHENTICATED USER
    // =======================================================

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
          success: false,
          error:
            "Invalid or expired login session.",
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


    // =======================================================
    // ADMIN CLIENT
    // =======================================================

    const adminClient =
      createClient(
        supabaseUrl,
        serviceRoleKey,
      );


    // =======================================================
    // CHECK ADMIN / STAFF
    // =======================================================

    const {
      data: admin,
      error: adminError,
    } =
      await adminClient
        .from("admins")
        .select(
          "id, email, role, page_permissions, must_change_password, is_active",
        )
        .eq(
          "id",
          user.id,
        )
        .maybeSingle();


    if (adminError) {

      console.error(
        "Admin lookup error:",
        adminError,
      );


      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Unable to verify administrator access.",
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


    if (!admin || !admin.is_active || admin.must_change_password) {

      return new Response(
        JSON.stringify({
          success: false,
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
      admin.role !== "ADMIN" &&
      admin.role !== "STAFF"
    ) {

      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Your account does not have permission to send tickets.",
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
      admin.role !== "ADMIN" &&
      !admin.page_permissions?.some((page: string) =>
        page === "tickets" || page === "participants"
      )
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Your account does not have permission to send tickets.",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }


    // =======================================================
    // READ REQUEST BODY
    // =======================================================

    const body =
      await req.json();


    const ticketId =
      body.ticket_id?.trim();


    if (!ticketId) {

      return new Response(
        JSON.stringify({
          success: false,
          error:
            "ticket_id is required.",
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


    // =======================================================
    // GET TICKET + PARTICIPANT + EVENT
    // =======================================================

    const {
      data: ticket,
      error: ticketError,
    } =
      await adminClient
        .from("tickets")
        .select(`
          id,
          ticket_id,
          qr_data,
          ticket_status,
          email_status,
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
              logo_url
            )
          )
        `)
        .eq(
          "ticket_id",
          ticketId,
        )
        .single();


    if (
      ticketError ||
      !ticket
    ) {

      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Ticket not found.",
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


    const participant =
      ticket.participant;


    const event =
      participant?.event;


    if (!participant) {

      throw new Error(
        "Participant information not found.",
      );
    }


    if (!event) {

      throw new Error(
        "Event information not found.",
      );
    }


    if (!participant.email) {

      throw new Error(
        "Participant does not have an email address.",
      );
    }


    // =======================================================
    // QR CODE
    // =======================================================

    const qrData =
      ticket.qr_data ||
      ticket.ticket_id;


    const qrCodeUrl =
      `https://quickchart.io/qr?text=${encodeURIComponent(
        qrData,
      )}&size=500&margin=2`;


    // =======================================================
    // FORMAT EVENT DATE
    // =======================================================

    let formattedDate =
      event.event_date || "";


    if (event.event_date) {

      try {

        const date =
          new Date(
            event.event_date +
            "T00:00:00",
          );


        formattedDate =
          date.toLocaleDateString(
            "en-GB",
            {
              day: "2-digit",
              month: "long",
              year: "numeric",
            },
          );

      } catch {

        formattedDate =
          event.event_date;

      }

    }


    // =======================================================
    // LOGO
    // =======================================================

    const logoHtml =
      event.logo_url

        ? `
          <img
            src="${escapeHtml(
              event.logo_url,
            )}"
            alt="SABSA Logo"
            style="
              max-width:180px;
              max-height:80px;
              object-fit:contain;
              margin-bottom:18px;
            "
          />
        `

        : `
          <div
            style="
              display:inline-block;
              padding:15px 25px;
              background:#ffffff;
              color:#111827;
              border-radius:10px;
              font-size:20px;
              font-weight:bold;
              margin-bottom:18px;
            "
          >
            SABSA
          </div>
        `;


    // =======================================================
    // EMAIL HTML
    // =======================================================

    const emailHtml = `
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
  ${escapeHtml(
    event.event_name,
  )}
</title>

</head>


<body
  style="
    margin:0;
    padding:0;
    background:#f1f3f6;
    font-family:Arial,Helvetica,sans-serif;
  "
>


<table
  width="100%"
  cellpadding="0"
  cellspacing="0"
  border="0"
>

<tr>

<td
  align="center"
  style="padding:30px 10px;"
>


<!-- =====================================================
     MAIN TICKET
===================================================== -->

<table
  width="650"
  cellpadding="0"
  cellspacing="0"
  border="0"
  style="
    max-width:650px;
    width:100%;
    background:#ffffff;
    border-radius:20px;
    overflow:hidden;
  "
>


<!-- =====================================================
     HEADER
===================================================== -->

<tr>

<td
  align="center"
  style="
    background:#111827;
    padding:35px 25px;
    color:#ffffff;
  "
>

${logoHtml}


<div
  style="
    font-size:30px;
    font-weight:bold;
    line-height:1.25;
  "
>

${escapeHtml(
  event.event_name,
)}

</div>


<div
  style="
    margin-top:10px;
    font-size:13px;
    letter-spacing:3px;
    text-transform:uppercase;
    color:#d1d5db;
  "
>

Electronic Event Ticket

</div>

</td>

</tr>


<!-- =====================================================
     BODY
===================================================== -->

<tr>

<td
  style="
    padding:35px;
  "
>


<!-- GREETING -->

<div
  style="
    font-size:16px;
    color:#111827;
    margin-bottom:25px;
  "
>

Dear
<strong>
${escapeHtml(
  participant.full_name,
)}
</strong>,

<br><br>

Your registration for
<strong>
${escapeHtml(
  event.event_name,
)}
</strong>
has been confirmed.

Please keep this email available and present the QR code at the entrance.

</div>


<!-- =====================================================
     ATTENDEE INFORMATION
===================================================== -->

<div
  style="
    font-size:12px;
    font-weight:bold;
    letter-spacing:1.5px;
    text-transform:uppercase;
    color:#6b7280;
    margin-bottom:15px;
  "
>

ATTENDEE INFORMATION

</div>


<table
  width="100%"
  cellpadding="0"
  cellspacing="0"
  border="0"
>

<tr>

<td
  width="50%"
  style="
    padding:12px 10px 12px 0;
    border-bottom:1px solid #e5e7eb;
  "
>

<div
  style="
    font-size:11px;
    color:#6b7280;
    text-transform:uppercase;
  "
>

Name

</div>


<div
  style="
    margin-top:5px;
    font-size:16px;
    font-weight:bold;
    color:#111827;
  "
>

${escapeHtml(
  participant.full_name,
)}

</div>

</td>


<td
  width="50%"
  style="
    padding:12px 0 12px 10px;
    border-bottom:1px solid #e5e7eb;
  "
>

<div
  style="
    font-size:11px;
    color:#6b7280;
    text-transform:uppercase;
  "
>

Registration No.

</div>


<div
  style="
    margin-top:5px;
    font-size:16px;
    font-weight:bold;
    color:#111827;
  "
>

${escapeHtml(
  participant.registration_no,
)}

</div>

</td>

</tr>


<tr>

<td
  width="50%"
  style="
    padding:12px 10px 12px 0;
    border-bottom:1px solid #e5e7eb;
  "
>

<div
  style="
    font-size:11px;
    color:#6b7280;
    text-transform:uppercase;
  "
>

Batch

</div>


<div
  style="
    margin-top:5px;
    font-size:16px;
    font-weight:bold;
    color:#111827;
  "
>

${escapeHtml(
  participant.batch ||
  "-",
)}

</div>

</td>


<td
  width="50%"
  style="
    padding:12px 0 12px 10px;
    border-bottom:1px solid #e5e7eb;
  "
>

<div
  style="
    font-size:11px;
    color:#6b7280;
    text-transform:uppercase;
  "
>

Meal

</div>


<div
  style="
    margin-top:5px;
    font-size:16px;
    font-weight:bold;
    color:#111827;
  "
>

${escapeHtml(
  participant.meal ||
  "-",
)}

</div>

</td>

</tr>

</table>


<!-- =====================================================
     EVENT INFORMATION
===================================================== -->

<div
  style="
    margin-top:30px;
    font-size:12px;
    font-weight:bold;
    letter-spacing:1.5px;
    text-transform:uppercase;
    color:#6b7280;
    margin-bottom:15px;
  "
>

EVENT INFORMATION

</div>


<table
  width="100%"
  cellpadding="0"
  cellspacing="0"
  border="0"
>

<tr>

<td
  style="
    padding:8px 0;
    font-size:15px;
    color:#374151;
  "
>

<strong>Date:</strong>

${escapeHtml(
  formattedDate,
)}

</td>

</tr>


<tr>

<td
  style="
    padding:8px 0;
    font-size:15px;
    color:#374151;
  "
>

<strong>Time:</strong>

${escapeHtml(
  event.event_time ||
  "-",
)}

</td>

</tr>


<tr>

<td
  style="
    padding:8px 0;
    font-size:15px;
    color:#374151;
  "
>

<strong>Venue:</strong>

${escapeHtml(
  event.venue ||
  "-",
)}

</td>

</tr>

</table>


<!-- =====================================================
     QR CODE
===================================================== -->

<div
  style="
    margin-top:30px;
    padding-top:30px;
    border-top:1px dashed #d1d5db;
    text-align:center;
  "
>


<div
  style="
    font-size:12px;
    font-weight:bold;
    letter-spacing:1.5px;
    text-transform:uppercase;
    color:#6b7280;
    margin-bottom:15px;
  "
>

ENTRY QR CODE

</div>


<img
  src="${qrCodeUrl}"
  alt="Ticket QR Code"
  width="250"
  height="250"
  style="
    display:block;
    width:250px;
    height:250px;
    margin:0 auto;
  "
>


<div
  style="
    margin-top:15px;
    font-family:monospace;
    font-size:16px;
    font-weight:bold;
    letter-spacing:1px;
    color:#111827;
  "
>

${escapeHtml(
  ticket.ticket_id,
)}

</div>


<div
  style="
    margin-top:10px;
    font-size:13px;
    color:#6b7280;
    line-height:1.5;
  "
>

Present this QR code at the event entrance.

</div>

</div>


</td>

</tr>


<!-- =====================================================
     FOOTER
===================================================== -->

<tr>

<td
  align="center"
  style="
    background:#f9fafb;
    border-top:1px solid #e5e7eb;
    padding:22px 30px;
    font-size:12px;
    line-height:1.6;
    color:#6b7280;
  "
>

This is an electronic ticket issued by
<strong>
SAB Students' Association.
</strong>

<br>

Please do not share your QR code with another person.

</td>

</tr>


</table>


<div
  style="
    max-width:650px;
    margin-top:15px;
    text-align:center;
    font-size:11px;
    color:#9ca3af;
  "
>

Ticket ID:
${escapeHtml(
  ticket.ticket_id,
)}

</div>


</td>

</tr>

</table>


</body>

</html>
`;


    // =======================================================
    // SEND EMAIL THROUGH RESEND
    // =======================================================

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

            // ------------------------------------------------
            // TEST SENDER
            // ------------------------------------------------
            //
            // We will change this to
            // ticket@sabsa.com after the
            // domain is verified in Resend.
            //

            from:
              "SABSA E-Tickets <onboarding@resend.dev>",


            to: [
              participant.email,
            ],


            subject:
              `Your E-Ticket - ${event.event_name}`,


            html:
              emailHtml,

          }),
        },
      );


    const resendData =
      await resendResponse.json();


    // =======================================================
    // RESEND FAILED
    // =======================================================

    if (!resendResponse.ok) {

      await adminClient
        .from("tickets")
        .update({
          email_status:
            "FAILED",
        })
        .eq(
          "id",
          ticket.id,
        );


      return new Response(
        JSON.stringify({

          success: false,

          error:
            resendData?.message ||
            "Failed to send email.",

          resend_response:
            resendData,

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


    // =======================================================
    // UPDATE EMAIL STATUS
    // =======================================================

    const {
      error: updateError,
    } =
      await adminClient
        .from("tickets")
        .update({
          email_status:
            "SENT",
        })
        .eq(
          "id",
          ticket.id,
        );


    if (updateError) {

      console.error(
        "Email sent but status update failed:",
        updateError,
      );

    }


    // =======================================================
    // SUCCESS
    // =======================================================

    return new Response(
      JSON.stringify({

        success: true,

        message:
          "E-ticket email sent successfully.",

        email:
          participant.email,

        ticket_id:
          ticket.ticket_id,

        event:
          event.event_name,

        email_status:
          "SENT",

        sent_by: {
          id: user.id,
          email: admin.email,
          role: admin.role,
        },

        resend_message_id:
          resendData?.id ||
          null,

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


  } catch (error) {

    console.error(
      "Send ticket error:",
      error,
    );


    return new Response(
      JSON.stringify({

        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error.",

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


// =========================================================
// HTML ESCAPING
// =========================================================

function escapeHtml(
  value: unknown,
): string {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }


  return String(value)

    .replace(
      /&/g,
      "&amp;",
    )

    .replace(
      /</g,
      "&lt;",
    )

    .replace(
      />/g,
      "&gt;",
    )

    .replace(
      /"/g,
      "&quot;",
    )

    .replace(
      /'/g,
      "&#039;",
    );
}

