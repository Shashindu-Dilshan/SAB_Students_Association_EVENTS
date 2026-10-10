import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  EMAIL_DUPLICATE_MESSAGE,
  REGISTRATION_DUPLICATE_MESSAGE,
  isEmailUniqueViolation,
  normalizeEmail,
} from "./registration-helpers.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RegistrationRequest {
  event_code: string;
  full_name: string;
  email: string;
  phone?: string;
  registration_no: string;
  batch?: string;
  gender?: string;
  meal?: string;
}

// Generate a random 6-character ticket code
function generateTicketCode(): string {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  const randomValues = new Uint32Array(6);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < 6; i++) {
    result += characters[randomValues[i] % characters.length];
  }

  return result;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

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
    const body: RegistrationRequest = await req.json();

    // Clean input values
    const eventCode = body.event_code?.trim();
    const fullName = body.full_name?.trim();
    const email = normalizeEmail(body.email);
    const phone = body.phone?.trim() || null;
    const registrationNo = body.registration_no?.trim();
    const batch = body.batch?.trim() || null;
    const gender = body.gender?.trim() || null;
    const meal = body.meal?.trim() || null;

    // Validate required fields
    if (!eventCode) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Event code is required.",
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

    if (!fullName) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Full name is required.",
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

    if (!email) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Email is required.",
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

    if (!registrationNo) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Registration number is required.",
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

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Please provide a valid email address.",
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

    // Supabase environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Supabase environment variables are missing.");

      return new Response(
        JSON.stringify({
          success: false,
          error: "Server configuration error.",
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

    // Server-side Supabase client
    // The service role key NEVER goes to the browser.
    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    // Find the event
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select(
        "id, event_name, event_code, registration_open",
      )
      .eq("event_code", eventCode)
      .maybeSingle();

    if (eventError) {
      console.error("Event lookup error:", eventError);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Unable to find the event.",
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

    if (!event) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Event not found.",
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

    // Check whether registration is open
    if (!event.registration_open) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Registration for this event is currently closed.",
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Check email first so duplicate email attempts get the clearest message.
    const { data: existingEmailParticipant, error: emailCheckError } =
      await supabase
        .from("participants")
        .select("id")
        .eq("event_id", event.id)
        .eq("email_normalized", email)
        .maybeSingle();

    if (emailCheckError) {
      console.error("Email duplicate check error:", emailCheckError);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Unable to verify registration.",
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

    if (existingEmailParticipant) {
      return new Response(
        JSON.stringify({
          success: false,
          error: EMAIL_DUPLICATE_MESSAGE,
        }),
        {
          status: 409,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const { data: existingRegistrationNumber, error: registrationCheckError } =
      await supabase
        .from("participants")
        .select("id")
        .eq("event_id", event.id)
        .eq("registration_no", registrationNo)
        .maybeSingle();

    if (registrationCheckError) {
      console.error("Registration number duplicate check error:", registrationCheckError);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Unable to verify registration.",
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

    if (existingRegistrationNumber) {
      return new Response(
        JSON.stringify({
          success: false,
          error: REGISTRATION_DUPLICATE_MESSAGE,
        }),
        {
          status: 409,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Create participant
    const { data: participant, error: participantError } =
      await supabase
        .from("participants")
        .insert({
          event_id: event.id,
          full_name: fullName,
          email: email,
          phone: phone,
          registration_no: registrationNo,
          batch: batch,
          gender: gender,
          meal: meal,
        })
        .select("id, full_name, email, registration_no")
        .single();

    if (participantError) {
      console.error(
        "Participant creation error:",
        participantError,
      );

      // Unique indexes remain the atomic protection for simultaneous requests.
      if (participantError.code === "23505") {
        let emailConflict = isEmailUniqueViolation(participantError);
        if (!emailConflict) {
          const { data: matchingEmail, error: matchingEmailError } =
            await supabase
              .from("participants")
              .select("id")
              .eq("event_id", event.id)
              .eq("email_normalized", email)
              .maybeSingle();
          if (matchingEmailError) {
            console.error("Unable to identify participant conflict:", matchingEmailError);
          }
          emailConflict = Boolean(matchingEmail);
        }

        return new Response(
          JSON.stringify({
            success: false,
            error: emailConflict
              ? EMAIL_DUPLICATE_MESSAGE
              : REGISTRATION_DUPLICATE_MESSAGE,
          }),
          {
            status: 409,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          },
        );
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: "Unable to create participant.",
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

    // Generate a unique ticket ID
    let ticketId = "";
    let ticketCreated = false;
    let ticketData = null;

    for (let attempt = 0; attempt < 10; attempt++) {
      const randomCode = generateTicketCode();

      // Example:
      // SAB26-7K4P9Q
      ticketId = `${event.event_code}-${randomCode}`;

      const { data, error: ticketError } = await supabase
        .from("tickets")
        .insert({
          participant_id: participant.id,
          ticket_id: ticketId,
          qr_data: ticketId,
          ticket_status: "ACTIVE",
          email_status: "PENDING",
        })
        .select(
          "id, ticket_id, qr_data, ticket_status, email_status",
        )
        .single();

      if (!ticketError) {
        ticketData = data;
        ticketCreated = true;
        break;
      }

      // Retry if random ticket ID happened to collide
      if (ticketError.code === "23505") {
        continue;
      }

      console.error("Ticket creation error:", ticketError);
      break;
    }

    // If ticket creation failed, remove participant
    if (!ticketCreated || !ticketData) {
      await supabase
        .from("participants")
        .delete()
        .eq("id", participant.id);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Unable to create ticket.",
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

    // Successful registration
    return new Response(
      JSON.stringify({
        success: true,
        message: "Registration successful.",
        event: {
          id: event.id,
          name: event.event_name,
          code: event.event_code,
        },
        participant: {
          id: participant.id,
          name: participant.full_name,
          email: participant.email,
          registration_no: participant.registration_no,
        },
        ticket: {
          id: ticketData.id,
          ticket_id: ticketData.ticket_id,
          qr_data: ticketData.qr_data,
          status: ticketData.ticket_status,
          email_status: ticketData.email_status,
        },
      }),
      {
        status: 201,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("Unexpected error:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: "An unexpected server error occurred.",
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