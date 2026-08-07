export function getAttachmentIcon(type) {
  return { image: "🖼️", video: "🎬", audio: "🎵", file: "📄" }[type] || "📎";
}
