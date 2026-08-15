const OWNER_TYPES = new Set(["owner", "admin", "administrator"]);
const WORKER_TYPES = new Set(["worker", "employee"]);

export function normalizeSenderType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (OWNER_TYPES.has(type)) return "owner";
  if (WORKER_TYPES.has(type)) return "worker";
  return null;
}

const actorIds = (actor) => new Set(
  [actor?.id, actor?.user_id, actor?.worker_id]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .map(String),
);

/** Returns true only when the message can be attributed to the current actor. */
export function isOwnMessage(message, currentActor) {
  const messageType = normalizeSenderType(message?.sender_type);
  const actorType = normalizeSenderType(currentActor?.type || currentActor?.sender_type);
  if (!messageType || !actorType || messageType !== actorType) return false;

  const senderId = message?.sender_id;
  if (senderId !== undefined && senderId !== null && String(senderId).trim()) {
    return actorIds(currentActor).has(String(senderId));
  }

  // Legacy messages without sender_id are safe because a conversation has one
  // owner side and one worker side. Unknown sender types never reach this path.
  if (messageType === "worker" && message?.worker_id) {
    return actorIds(currentActor).has(String(message.worker_id));
  }
  return messageType === "owner";
}

export function isSameMessageSender(message, previousMessage) {
  if (!message || !previousMessage) return false;
  const type = normalizeSenderType(message.sender_type);
  if (!type || type !== normalizeSenderType(previousMessage.sender_type)) return false;

  const senderId = message.sender_id ? String(message.sender_id) : null;
  const previousSenderId = previousMessage.sender_id ? String(previousMessage.sender_id) : null;
  return !senderId || !previousSenderId || senderId === previousSenderId;
}
