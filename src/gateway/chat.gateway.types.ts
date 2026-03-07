export type ChatMessage = { chatId: string; message: string };
export type ChatStatusMessage = { chatId: string; message: string; type: 'chat_title_refreshed' | 'ai_update' | 'process_update' };
export type ChatFeedbackMessage = {
  chatId: string;
  feedback: 'awesome' | 'great' | 'duh' | 'wtf';
};
