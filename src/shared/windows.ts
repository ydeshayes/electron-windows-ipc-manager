// This file is auto-generated. Do not edit manually.

export interface Windows {}

export type WindowDefinitions = {
  [K in keyof Windows]: {
    [M in keyof Windows[K]]: Windows[K][M];
  };
};
