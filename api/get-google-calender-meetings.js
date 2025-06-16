const { google } = require("googleapis");
require("dotenv").config();
const { format, isValid, startOfDay, endOfDay, addDays } = require("date-fns");
const { zonedTimeToUtc, utcToZonedTime } = require("date-fns-tz");
const chrono = require("chrono-node");

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://orbit-ai-scheduling-endpoint.vercel.app/api/auth/google/callback"
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: "v3", auth: oauth2Client });

const TIME_ZONE = "America/Los_Angeles";

// Function to parse date string (same as your original)
const parseDateString = (dateStr) => {
  if (!dateStr || typeof dateStr !== "string") {
    return format(new Date(), "yyyy-MM-dd");
  }

  dateStr = dateStr.trim().replace(/\s+/g, " ").toLowerCase();

  if (dateStr === "today") return format(new Date(), "yyyy-MM-dd");
  if (dateStr === "tomorrow")
    return format(addDays(new Date(), 1), "yyyy-MM-dd");

  const chronoParsed = chrono.parseDate(dateStr);
  if (chronoParsed && isValid(chronoParsed)) {
    return format(chronoParsed, "yyyy-MM-dd");
  }

  return format(new Date(), "yyyy-MM-dd");
};

// Function to format meeting data for response
const formatMeetingData = (event) => {
  const startDateTime = new Date(event.start.dateTime || event.start.date);
  const endDateTime = new Date(event.end.dateTime || event.end.date);
  
  // Convert to Pacific Time for display
  const pacificStartTime = utcToZonedTime(startDateTime, TIME_ZONE);
  const pacificEndTime = utcToZonedTime(endDateTime, TIME_ZONE);

  return {
    id: event.id,
    summary: event.summary || "No Title",
    description: event.description || "",
    startTime: format(pacificStartTime, "h:mm a"),
    endTime: format(pacificEndTime, "h:mm a"),
    startDateTime: pacificStartTime.toISOString(),
    endDateTime: pacificEndTime.toISOString(),
    htmlLink: event.htmlLink,
    status: event.status,
    attendees: event.attendees || [],
    location: event.location || "",
  };
};

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Support both GET (query params) and POST (body) methods
    const date = req.method === "GET" ? req.query.date : req.body.date;
    
    console.log("Requested date:", date);

    if (!date) {
      return res.status(400).json({
        success: false,
        error: "Date parameter is required",
      });
    }

    // Parse the date
    const parsedDate = parseDateString(date);
    if (!parsedDate) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Please provide a valid date.",
      });
    }

    // Create start and end of day in Pacific Time, then convert to UTC for API call
    const dateObj = new Date(parsedDate);
    const startOfDayPacific = startOfDay(dateObj);
    const endOfDayPacific = endOfDay(dateObj);
    
    const startTimeUTC = zonedTimeToUtc(startOfDayPacific, TIME_ZONE);
    const endTimeUTC = zonedTimeToUtc(endOfDayPacific, TIME_ZONE);

    console.log("Date range UTC:", {
      start: startTimeUTC.toISOString(),
      end: endTimeUTC.toISOString()
    });

    // Fetch events from Google Calendar
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: startTimeUTC.toISOString(),
      timeMax: endTimeUTC.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50, // Adjust as needed
    });

    const events = response.data.items || [];
    
    // Format the events
    const formattedMeetings = events.map(formatMeetingData);

    // Group meetings by time for better organization
    const meetingsByTime = formattedMeetings.reduce((acc, meeting) => {
      const timeSlot = meeting.startTime;
      if (!acc[timeSlot]) {
        acc[timeSlot] = [];
      }
      acc[timeSlot].push(meeting);
      return acc;
    }, {});

    return res.json({
      success: true,
      date: format(dateObj, "MMMM d, yyyy"),
      dateRequested: parsedDate,
      totalMeetings: formattedMeetings.length,
      meetings: formattedMeetings,
      meetingsByTime: meetingsByTime,
      message: formattedMeetings.length > 0 
        ? `Found ${formattedMeetings.length} meeting(s) for ${format(dateObj, "MMMM d, yyyy")}`
        : `No meetings found for ${format(dateObj, "MMMM d, yyyy")}`,
    });

  } catch (error) {
    console.error("Error fetching meetings:", error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || "Failed to fetch meetings"
    });
  }
};
