// Retell's transcript_with_tool_calls entries store arguments/content as
// JSON *strings*, not objects — confirmed against real call_logs rows.
function parseJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Extracts the caller's name from a completed call's transcript_with_tool_calls,
// when the agent captured one via a booking tool during the call.
//
// Prefers tool_call_result entries (their booking.customer_name reflects what
// actually got saved to the bookings table) over tool_call_invocation
// arguments (the LLM inconsistently uses customerName/full_name/name/
// customer_name across real calls — see retellBookAppointment.js).
export function extractCallerName(transcriptWithToolCalls) {
  if (!Array.isArray(transcriptWithToolCalls)) return null;

  for (const entry of transcriptWithToolCalls) {
    if (entry?.role !== "tool_call_result") continue;
    const content = parseJson(entry.content);
    const name = content?.booking?.customer_name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }

  for (const entry of transcriptWithToolCalls) {
    if (entry?.role !== "tool_call_invocation") continue;
    const args = parseJson(entry.arguments);
    const name =
      args?.customerName || args?.full_name || args?.name || args?.customer_name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }

  return null;
}
