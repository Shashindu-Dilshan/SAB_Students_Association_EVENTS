(() => {
  "use strict";

  const SUPABASE_URL = "https://xdaxxgsvorvfpnxteikv.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_wRysyx1ek-J7XrFOLxXfnA_Fp_0UsFO";
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const EVENT_FIELDS = "event_name,event_code,event_date,event_time,venue,description,logo_url,registration_open,show_qr_after_registration,created_at";

  function formatEventDate(dateValue) {
    if (!dateValue) return "Date to be announced";
    const date = new Date(dateValue + "T12:00:00");
    return Number.isNaN(date.getTime())
      ? dateValue
      : new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(date);
  }

  function setRegistrationState(isOpen) {
    const button = document.getElementById("register-button");
    const badge = document.getElementById("registration-status");
    badge.textContent = isOpen ? "Registration Open" : "Registration Closed";
    badge.classList.toggle("is-closed", !isOpen);
    button.setAttribute("aria-disabled", String(!isOpen));

    if (isOpen) {
      button.removeAttribute("tabindex");
    } else {
      button.removeAttribute("href");
      button.setAttribute("tabindex", "-1");
    }
  }

  function setEventLogo(logoUrl) {
    const image = document.getElementById("event-logo");
    const placeholder = document.getElementById("event-logo-placeholder");
    if (!logoUrl) return;

    try {
      const parsed = new URL(logoUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    } catch {
      return;
    }

    image.onload = () => {
      image.hidden = false;
      placeholder.hidden = true;
    };
    image.onerror = () => {
      image.hidden = true;
      placeholder.hidden = false;
    };
    image.src = logoUrl;
  }

  async function fetchCurrentEvent(eventCode = "") {
    let query = supabaseClient.from("events").select(EVENT_FIELDS);
    if (eventCode) {
      query = query.eq("event_code", eventCode);
    } else {
      query = query.order("created_at", { ascending: false }).limit(1);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  }

  async function loadCurrentEvent() {
    const noEvent = document.getElementById("no-event-state");
    const hero = document.getElementById("event-content");
    const data = await fetchCurrentEvent();

    if (!data) {
      hero.hidden = true;
      noEvent.hidden = false;
      return;
    }

    document.getElementById("event-name").textContent = data.event_name || "SABSA Event";
    document.getElementById("event-card-name").textContent = data.event_name || "SABSA Event";
    document.getElementById("event-summary").textContent = data.description || "Join the SABSA community for an upcoming event.";
    document.getElementById("event-date").textContent = formatEventDate(data.event_date);
    document.getElementById("event-time").textContent = data.event_time || "Time to be announced";
    document.getElementById("event-venue").textContent = data.venue || "Venue to be announced";
    document.getElementById("event-description").textContent = data.description || "More details will be announced soon.";
    document.getElementById("event-logo").alt = data.event_name ? data.event_name + " logo" : "Event logo";
    setEventLogo(data.logo_url);
    setRegistrationState(Boolean(data.registration_open));

    if (data.registration_open) {
      document.getElementById("register-button").href =
        "register.html?event_code=" + encodeURIComponent(data.event_code || "");
    }
  }

  function showUnavailable(title, message) {
    document.getElementById("registration-loading").hidden = true;
    document.getElementById("registration-layout").hidden = true;
    document.getElementById("registration-unavailable-title").textContent = title;
    document.getElementById("registration-unavailable-message").textContent = message;
    document.getElementById("registration-unavailable").hidden = false;
  }

  async function loadRegistrationEvent() {
    const params = new URLSearchParams(window.location.search);
    const requestedEventCode = params.get("event_code")?.trim() || "";
    const event = await fetchCurrentEvent(requestedEventCode);

    if (!event) {
      showUnavailable(
        "No active event is currently available.",
        "Please return to the event page and check back later."
      );
      return null;
    }

    const showQrAfterRegistration =
      event.show_qr_after_registration === true;

    document.getElementById("registration-loading").hidden = true;
    document.getElementById("registration-layout").hidden = false;
    document.getElementById("registration-event-name").textContent = event.event_name || "SABSA Event";
    const eventDate = formatEventDate(event.event_date);
    const eventTime = event.event_time || "Time to be announced";
    const venue = event.venue || "Venue to be announced";
    document.getElementById("registration-event-details").textContent =
      [eventDate, eventTime, venue].join(" · ");

    if (!event.registration_open) {
      document.getElementById("registration-form-card").hidden = true;
      showUnavailable(
        "Registration is closed.",
        "Registration for this event is currently closed. Please check the SABSA events page for updates."
      );
      return null;
    }

    return {
      ...event,
      show_qr_after_registration: showQrAfterRegistration
    };
  }

  function displayFormError(message) {
    const box = document.getElementById("form-message");
    box.textContent = message;
    box.hidden = false;
    box.className = "form-error";
  }

  async function registrationErrorMessage(error) {
    const status = error?.context?.status || error?.status || 0;
    let serverMessage = "";

    if (error?.context && typeof error.context.clone === "function") {
      try {
        const payload = await error.context.clone().json();
        serverMessage = payload?.error || payload?.message || "";
      } catch {
        // The server may return a non-JSON error body.
      }
    }

    if (status === 409) {
      return serverMessage ||
        "This participant is already registered for this event.";
    }
    if (status === 403) {
      return "Registration for this event is currently closed.";
    }
    if (status === 401) {
      return "The registration service is unavailable right now. Please try again later.";
    }
    if (status >= 500) {
      return "The registration service is temporarily unavailable. Please try again later.";
    }
    return serverMessage || "We could not complete your registration. Check your connection and try again.";
  }

  async function showRegistrationSuccess(data, registrationEvent) {
    const ticketId = data?.ticket?.ticket_id;
    if (typeof ticketId !== "string" || !ticketId.trim()) {
      throw new Error("The registration was received, but the ticket details were missing. Please contact the event administration.");
    }

    document.getElementById("registration-form-card").hidden = true;
    document.getElementById("success-welcome").textContent =
      "Welcome, " + (data?.participant?.name || "SABSA participant");
    document.getElementById("success-ticket-id").textContent = ticketId;
    document.getElementById("registration-success").hidden = false;

    const qrCanvas = document.getElementById("ticket-qr");
    const qrWrap = document.getElementById("qr-wrap");
    const qrError = document.getElementById("qr-error");
    const qrNotDisplayed = document.getElementById("qr-not-displayed");
    const downloadButton = document.getElementById("download-qr");
    const ticketNote = document.getElementById("success-ticket-note");

    if (registrationEvent?.show_qr_after_registration !== true) {
      qrCanvas.hidden = true;
      qrWrap.hidden = true;
      qrError.hidden = true;
      downloadButton.hidden = true;
      qrNotDisplayed.hidden = false;
      ticketNote.textContent =
        "Please retain your Ticket ID. Your electronic ticket may be sent separately by the event administration.";
      return;
    }

    qrCanvas.hidden = true;
    qrWrap.hidden = true;
    qrError.hidden = true;
    downloadButton.hidden = true;
    qrNotDisplayed.hidden = true;
    ticketNote.textContent =
      "Please save your Ticket ID and QR code. Your electronic ticket may be sent separately by the event administration.";

    try {
      if (!window.QRCode || typeof window.QRCode.toCanvas !== "function") {
        throw new Error("QR library unavailable");
      }
      await window.QRCode.toCanvas(qrCanvas, ticketId, {
        width: 220,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#10284b", light: "#ffffff" }
      });
      if (typeof qrCanvas.toDataURL !== "function") {
        throw new Error("Canvas download is unavailable");
      }
    } catch (error) {
      console.error("Unable to generate ticket QR code:", error);
      qrCanvas.hidden = true;
      qrWrap.hidden = true;
      qrError.hidden = false;
      downloadButton.hidden = true;
      ticketNote.textContent =
        "Please retain your Ticket ID. Your electronic ticket may be sent separately by the event administration.";
      return;
    }

    downloadButton.addEventListener("click", () => {
      const link = document.createElement("a");
      link.href = qrCanvas.toDataURL("image/png");
      link.download = ticketId + "-QR.png";
      link.click();
    }, { once: true });
    qrCanvas.hidden = false;
    qrWrap.hidden = false;
    downloadButton.hidden = false;
  }

  async function handleRegistrationSubmit(event, registrationEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const messageBox = document.getElementById("form-message");
    const submitButton = document.getElementById("submit-registration");
    messageBox.hidden = true;

    const requiredFields = [...form.querySelectorAll("[required]")];
    requiredFields.forEach((field) => {
      field.setAttribute("aria-invalid", String(!field.value.trim() || !field.validity.valid));
    });

    if (!form.reportValidity()) {
      displayFormError("Please complete all required fields with valid information.");
      const firstInvalid = requiredFields.find((field) => !field.value.trim() || !field.validity.valid);
      firstInvalid?.focus();
      return;
    }

    const formData = new FormData(form);
    const payload = {
      event_code: registrationEvent.event_code,
      full_name: String(formData.get("full_name")).trim(),
      email: String(formData.get("email")).trim().toLowerCase(),
      phone: String(formData.get("phone") || "").trim(),
      registration_no: String(formData.get("registration_no")).trim(),
      batch: String(formData.get("batch")).trim(),
      gender: String(formData.get("gender")).trim(),
      meal: String(formData.get("meal")).trim()
    };

    submitButton.disabled = true;
    submitButton.textContent = "Submitting registration…";
    try {
      const { data, error } = await supabaseClient.functions.invoke(
        "register-participant",
        { body: payload }
      );

      if (error) {
        displayFormError(await registrationErrorMessage(error));
        return;
      }
      if (!data?.success) {
        displayFormError(data?.error || "We could not complete your registration. Please try again.");
        return;
      }
      await showRegistrationSuccess(data, registrationEvent);
    } catch (error) {
      console.error("Registration request failed:", error);
      displayFormError(error?.message?.includes("ticket details")
        ? error.message
        : "We could not connect to the registration service. Please try again.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Complete registration →";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (document.body.dataset.page === "landing") {
      const button = document.getElementById("register-button");
      button.addEventListener("click", (event) => {
        if (button.getAttribute("aria-disabled") === "true") event.preventDefault();
      });

      loadCurrentEvent().catch((error) => {
        console.error("Unable to load event information:", error);
        document.getElementById("event-load-message").textContent =
          "We could not load event details right now. Please refresh the page in a moment.";
        document.getElementById("event-load-message").hidden = false;
        document.getElementById("registration-status").textContent = "Registration status unavailable";
        document.getElementById("register-button").setAttribute("aria-disabled", "true");
        document.getElementById("register-button").removeAttribute("href");
      });
    }

    if (document.body.dataset.page === "registration") {
      loadRegistrationEvent()
        .then((registrationEvent) => {
          if (!registrationEvent) return;
          document.getElementById("registration-form").addEventListener(
            "submit",
            (event) => handleRegistrationSubmit(event, registrationEvent)
          );
        })
        .catch((error) => {
          console.error("Unable to load registration event:", error);
          showUnavailable(
            "Event information is unavailable.",
            "We could not load event information right now. Please return to the event page and try again."
          );
        });
    }
  });
})();
