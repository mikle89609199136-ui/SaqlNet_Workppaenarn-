export function getAttachmentIcon(type: string): string {
  return { image: "🖼️", video: "🎬", audio: "🎵", file: "📄" }[type] || "📎";
}
