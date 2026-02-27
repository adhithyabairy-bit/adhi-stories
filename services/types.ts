
export enum StoryGenre {
  FAIRY_TALE = 'Fairy Tale',
  SCI_FI = 'Sci-Fi',
  MYSTERY = 'Mystery',
  FANTASY = 'Fantasy',
  PROFESSIONAL = 'Professional/Business Case',
  HISTORICAL = 'Historical Fiction',
  HORROR = 'Horror',
  ADVENTURE = 'Adventure'
}

export enum ImageStyle {
  CARTOON = 'Cartoon',
  REALISTIC = 'Realistic',
  ANIME = 'Anime',
  WATERCOLOR = 'Watercolor',
  CYBERPUNK = 'Cyberpunk',
  OIL_PAINTING = 'Oil Painting',
  SKETCH = 'Pencil Sketch'
}

export interface StoryPart {
  subtitle: string;
  content: string;
}

export interface StoryResponse {
  title: string;
  summary: string;
  parts: StoryPart[];
  moralOrTakeaway: string;
  language: string;
}

export interface StoryRequest {
  elements: string[];
  language: string;
  genre: StoryGenre;
  imageStyle: ImageStyle;
}
