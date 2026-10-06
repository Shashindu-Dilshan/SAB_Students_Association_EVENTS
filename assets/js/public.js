(() => {
  "use strict";

  const SUPABASE_URL = "https://xdaxxgsvorvfpnxteikv.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_wRysyx1ek-J7XrFOLxXfnA_Fp_0UsFO";
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const EVENT_FIELDS = "event_name,event_code,event_date,event_time,venue,description,logo_url,registration_open,created_at";

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

  async function loadCurrentEvent() {
    const statusMessage = document.getElementById("event-load-message");
    const noEvent = document.getElementById("no-event-state");
    const hero = document.getElementById("event-content");
    const { data, error } = await supabaseClient
      .from("events")
      .select(EVENT_FIELDS)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

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

  document.addEventListener("DOMContentLoaded", () => {
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
  });
})();
