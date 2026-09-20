export {
  type EmailLogger,
  type EmailMessage,
  type EmailSender,
  type EmailSendResult,
  type RenderedEmail,
} from "./email-message.js";
export { createEmailSender, type EmailSenderOptions } from "./create-email-sender.js";
export { escapeHtml } from "./html.js";
export {
  LoggingEmailSender,
  type LoggingEmailSenderOptions,
} from "./logging-email-sender.js";
export { renderEmailDelivery, type RenderEmailDeliveryResult } from "./render-email-delivery.js";
export {
  RESEND_EMAILS_ENDPOINT,
  ResendEmailSender,
  type ResendEmailSenderOptions,
} from "./resend-email-sender.js";
export { renderInvitationEmail } from "./templates/invitation-email.js";
export { renderPasswordResetEmail } from "./templates/password-reset-email.js";
