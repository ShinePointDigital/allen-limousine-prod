export interface ImageStorage {
  resolve(source: string): string;
}

export class RemoteImageStorage implements ImageStorage {
  resolve(source: string) {
    const url = new URL(source);
    if (url.protocol !== "https:") throw new Error("Image URLs must use HTTPS.");
    return url.toString();
  }
}

export const imageStorage: ImageStorage = new RemoteImageStorage();