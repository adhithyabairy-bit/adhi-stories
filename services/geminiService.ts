
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { StoryRequest, StoryResponse, ImageStyle } from "./types";

const getAI = () => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error("Gemini API key is not set. Please add it to your .env file as VITE_GEMINI_API_KEY.");
  }
  return new GoogleGenAI({ apiKey });
};

export const generateStory = async (req: StoryRequest): Promise<StoryResponse> => {
  const { elements, language, genre } = req;
  const elementsString = elements.join(", ");

  const response = await getAI().models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Write a creative and engaging ${genre} story in ${language} language. 
    The story MUST incorporate these elements: ${elementsString}.
    The response must be highly structured and meaningful.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "A catchy and thematic title for the story." },
          summary: { type: Type.STRING, description: "A brief summary of what the story is about." },
          parts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                subtitle: { type: Type.STRING, description: "The subtitle for this specific section of the story." },
                content: { type: Type.STRING, description: "The actual narrative content of this section." }
              },
              required: ["subtitle", "content"]
            }
          },
          moralOrTakeaway: { type: Type.STRING, description: "A moral lesson, reflection, or key takeaway from the story." },
          language: { type: Type.STRING, description: "The language in which the story was written." }
        },
        required: ["title", "summary", "parts", "moralOrTakeaway", "language"]
      }
    }
  });

  const jsonStr = response.text.trim();
  return JSON.parse(jsonStr) as StoryResponse;
};

export const generateStoryImage = async (prompt: string, style: ImageStyle): Promise<string | null> => {
  try {
    const response = await getAI().models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `An illustration for a story. Style: ${style}. Subject: ${prompt}. Ensure high quality, vibrant colors, and thematic consistency.`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1"
        }
      },
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image generation error:", error);
    return null;
  }
};

export const generateSpeech = async (text: string, voiceName: string = 'Kore'): Promise<string | null> => {
  try {
    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error) {
    console.error("TTS generation error:", error);
    return null;
  }
};
