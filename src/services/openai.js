const MODEL = 'llama-3.3-70b-versatile';

let lastCall = 0;
const COOLDOWN = 1000;

const waitCooldown = async () => {
  const now = Date.now();
  const diff = now - lastCall;
  if (diff < COOLDOWN) {
    await new Promise((r) => setTimeout(r, COOLDOWN - diff));
  }
  lastCall = Date.now();
};

const generate = async (messages, jsonMode = false) => {
  await waitCooldown();

  const apiKey = process.env.EXPO_PUBLIC_GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('Missing EXPO_PUBLIC_GROQ_API_KEY');
  }

  const body = {
    model: MODEL,
    messages,
    temperature: 0.7,
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
};

export const generateSummary = async (content) => {
  const prompt = `Summarize the following study notes in simple language with bullet points:\n\n${content.slice(0, 6000)}`;

  const messages = [
    { role: 'system', content: 'You are a helpful study assistant. Create concise summaries.' },
    { role: 'user', content: prompt },
  ];

  return await generate(messages);
};

export const generateFlashcards = async (content) => {
  const prompt = `Create 10 flashcards from the following content.
Respond ONLY in JSON format with this structure:
{
  "flashcards": [
    { "question": "Question here", "answer": "Answer here" }
  ]
}

Content:
${content.slice(0, 4000)}`;

  const messages = [
    { role: 'system', content: 'You are a helpful study assistant. output JSON only.' },
    { role: 'user', content: prompt },
  ];

  try {
    const text = await generate(messages, true);
    console.log('[OpenAI] Raw flashcard response:', text);

    // Try to parse the response
    try {
      const parsed = JSON.parse(text);
      const flashcards = parsed.flashcards || parsed;
      
      if (!Array.isArray(flashcards)) {
        throw new Error('Invalid flashcard format received');
      }
      
      console.log('[OpenAI] Parsed flashcards:', flashcards);
      return flashcards;
    } catch (parseError) {
      console.error('[OpenAI] JSON parse error:', parseError);
      
      // Try to extract JSON from the response
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const flashcards = parsed.flashcards || parsed;
        
        if (!Array.isArray(flashcards)) {
          throw new Error('Invalid flashcard format in extracted JSON');
        }
        
        console.log('[OpenAI] Extracted flashcards:', flashcards);
        return flashcards;
      }
      
      throw new Error('Failed to parse flashcards JSON. Response was not valid JSON.');
    }
  } catch (error) {
    console.error('[OpenAI] Flashcard generation failed:', error);
    throw new Error(`Failed to generate flashcards: ${error.message}`);
  }
};

export const generateQuiz = async (content) => {
  const prompt = `
Generate 5 Multiple Choice Questions (MCQ) from the content.
Respond ONLY in JSON format with this structure:
{
  "quiz": [
    {
      "question": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0
    }
  ]
}
Note: correctAnswer is the index (0-3) of the correct option.

Content:
${content.slice(0, 4000)}
`;

  const messages = [
    { role: 'system', content: 'You are a helpful study assistant. Output JSON only.' },
    { role: 'user', content: prompt },
  ];

  try {
    const text = await generate(messages, true);
    console.log('[OpenAI] Raw quiz response:', text);

    // Try to parse the response
    try {
      const parsed = JSON.parse(text);
      const quiz = parsed.quiz || parsed;
      
      if (!Array.isArray(quiz)) {
        throw new Error('Invalid quiz format received');
      }
      
      // Validate quiz structure
      quiz.forEach((q, index) => {
        if (!q.question || !Array.isArray(q.options) || q.options.length !== 4 || typeof q.correctAnswer !== 'number') {
          throw new Error(`Invalid quiz question structure at index ${index}`);
        }
      });
      
      console.log('[OpenAI] Parsed quiz:', quiz);
      return quiz;
    } catch (parseError) {
      console.error('[OpenAI] JSON parse error:', parseError);
      
      // Try to extract JSON from the response
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const quiz = parsed.quiz || parsed;
        
        if (!Array.isArray(quiz)) {
          throw new Error('Invalid quiz format in extracted JSON');
        }
        
        // Validate extracted quiz structure
        quiz.forEach((q, index) => {
          if (!q.question || !Array.isArray(q.options) || q.options.length !== 4 || typeof q.correctAnswer !== 'number') {
            throw new Error(`Invalid quiz question structure at index ${index}`);
          }
        });
        
        console.log('[OpenAI] Extracted quiz:', quiz);
        return quiz;
      }
      
      throw new Error('Failed to parse quiz JSON. Response was not valid JSON.');
    }
  } catch (error) {
    console.error('[OpenAI] Quiz generation failed:', error);
    throw new Error(`Failed to generate quiz: ${error.message}`);
  }
};

export const chatWithTutor = async (messages) => {
  const systemMessage = {
    role: 'system',
    content:
      'You are a friendly and knowledgeable AI tutor. Keep answers concise and helpful. Use the context provided by the user to answer questions.',
  };

  const conversation = [systemMessage, ...messages];
  const reply = await generate(conversation);
  return { role: 'assistant', content: reply };
};
