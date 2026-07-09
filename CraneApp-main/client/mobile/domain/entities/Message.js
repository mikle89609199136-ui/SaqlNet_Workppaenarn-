class Message {
  constructor({
    id,
    chatId,
    senderId,
    content,
    type = 'text',
    timestamp = new Date(),
    isRead = false,
    attachments = [],
    editedAt = null,
    isEdited = false,
    reactions = [],
    replyTo = null,
    replyToContent = null,
    status = 'sent',
    mediaUrl = null,
    mediaOriginalUrl = null,
    mediaType = null,
    mediaEncrypted = false,
    mediaEncryption = null,
    mediaUnavailable = false,
    mediaUnavailableReason = null,
    voiceDuration = 0,
    senderUsername = null,
    senderFirstName = null,
    senderStatusEmoji = null,
  }) {
    this.id = id;
    this.chatId = chatId;
    this.senderId = senderId;
    this.content = content;
    this.type = type;
    this.timestamp = timestamp instanceof Date ? timestamp : new Date(timestamp);
    this.isRead = Boolean(isRead);
    this.attachments = attachments;
    this.editedAt = editedAt;
    this.isEdited = Boolean(isEdited);
    this.reactions = reactions;
    this.replyTo = replyTo;
    this.replyToContent = replyToContent;
    this.status = status;
    this.mediaUrl = mediaUrl;
    this.mediaOriginalUrl = mediaOriginalUrl;
    this.mediaType = mediaType;
    this.mediaEncrypted = Boolean(mediaEncrypted);
    this.mediaEncryption = mediaEncryption;
    this.mediaUnavailable = Boolean(mediaUnavailable);
    this.mediaUnavailableReason = mediaUnavailableReason;
    this.voiceDuration = voiceDuration || 0;
    this.senderUsername = senderUsername;
    this.senderFirstName = senderFirstName;
    this.senderStatusEmoji = senderStatusEmoji;
  }

  static fromAPI(data) {
    return new Message({
      id: data.id,
      chatId: data.chatId ?? data.chat_id,
      senderId: data.senderId ?? data.sender_id,
      content: data.content,
      type: data.type ?? 'text',
      timestamp: data.timestamp ?? data.createdAt ?? data.created_at,
      isRead: data.isRead ?? data.is_read ?? false,
      attachments: data.attachments ?? [],
      replyTo: data.replyTo ?? data.reply_to ?? null,
      replyToContent: data.replyToContent ?? data.reply_to_content ?? data.replyToData?.content ?? null,
      isEdited: data.isEdited ?? data.is_edited ?? false,
      editedAt: data.editedAt ?? data.edited_at ?? null,
      reactions: data.reactions ?? [],
      status: data.status ?? 'sent',
      mediaUrl: data.mediaUrl ?? data.media_url ?? null,
      mediaOriginalUrl: data.mediaOriginalUrl ?? data.media_original_url ?? null,
      mediaType: data.mediaType ?? data.media_type ?? null,
      mediaEncrypted: data.mediaEncrypted ?? data.media_encrypted ?? false,
      mediaEncryption: data.mediaEncryption ?? data.media_encryption ?? null,
      mediaUnavailable: data.mediaUnavailable ?? data.media_unavailable ?? false,
      mediaUnavailableReason: data.mediaUnavailableReason ?? data.media_unavailable_reason ?? null,
      voiceDuration: data.voiceDuration ?? data.voice_duration ?? 0,
      senderUsername: data.senderUsername ?? data.sender_username ?? null,
      senderFirstName: data.senderFirstName ?? data.sender_first_name ?? null,
      senderStatusEmoji: data.senderStatusEmoji ?? data.sender_status_emoji ?? null,
    });
  }

  toAPI() {
    return {
      id: this.id,
      chatId: this.chatId,
      senderId: this.senderId,
      content: this.content,
      type: this.type,
      timestamp: this.timestamp.toISOString(),
      isRead: this.isRead,
      attachments: this.attachments,
      editedAt: this.editedAt,
      isEdited: this.isEdited,
      reactions: this.reactions,
      replyTo: this.replyTo,
      replyToContent: this.replyToContent,
      status: this.status,
      mediaUrl: this.mediaUrl,
      mediaOriginalUrl: this.mediaOriginalUrl,
      mediaType: this.mediaType,
      mediaEncrypted: this.mediaEncrypted,
      mediaEncryption: this.mediaEncryption,
      mediaUnavailable: this.mediaUnavailable,
      mediaUnavailableReason: this.mediaUnavailableReason,
      voiceDuration: this.voiceDuration,
      senderUsername: this.senderUsername,
      senderFirstName: this.senderFirstName,
      senderStatusEmoji: this.senderStatusEmoji,
    };
  }

  markAsRead() {
    this.isRead = true;
    this.status = 'read';
    return this;
  }

  isFromUser(userId) {
    return this.senderId === userId;
  }

  hasAttachments() {
    return this.attachments.length > 0;
  }
}

export default Message;
