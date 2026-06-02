// types/email.events.d.ts

export interface FeedbackSubmittedEventData {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  feedbackMessage: string;
  timestamp: string;
  userAgent: string;
  ipAddress: string;
}

// Add to existing event types if you have them, or create this file if empty