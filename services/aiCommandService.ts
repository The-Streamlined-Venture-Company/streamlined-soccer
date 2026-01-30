import { supabase } from '../lib/supabase';

interface AICommandResponse {
  response: string;
  success: boolean;
  error?: string;
}

interface ConversationMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

/**
 * Send a command to the AI and get a response
 */
export async function sendAICommand(
  message: string,
  conversationHistory: ConversationMessage[] = []
): Promise<AICommandResponse> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  // Get the current session for auth
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('You must be signed in to use AI features');
  }

  console.log('AI Command: sending message...', message);

  try {
    const response = await supabase.functions.invoke<AICommandResponse>('ai-command', {
      body: {
        message,
        conversationHistory,
      },
    });

    console.log('AI Command: response received', response);

    if (response.error) {
      throw new Error(response.error.message || 'Failed to process command');
    }

    if (!response.data) {
      throw new Error('No response from AI');
    }

    return response.data;
  } catch (err) {
    console.error('AI Command error:', err);
    throw err;
  }
}

/**
 * Convert chat history to Gemini conversation format
 */
export function formatConversationHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): ConversationMessage[] {
  return messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));
}
