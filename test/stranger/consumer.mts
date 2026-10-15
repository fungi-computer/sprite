import {
  characterSchema,
  createSprite,
  type AvatarPresentation,
} from "@fungi.computer/sprite";
import renderVideo from "@fungi.computer/sprite/video";

const character = characterSchema.parse({
  version: 1,
  name: "stranger",
  renderer: "video",
  controls: {},
  data: { clips: { idle: "idle.mp4" } },
});
const presentation: AvatarPresentation = {
  src: "stranger.sprite.json",
  activity: "idle",
};
const service = createSprite({
  assets: {
    baseURL: "https://art.example/",
    allowedOrigins: ["https://art.example"],
    maxBytes: 1024,
    maxTotalBytes: 4096,
    maxRequests: 8,
  },
  renderers: { video: () => import("@fungi.computer/sprite/video") },
});
void character;
void presentation;
void service;
void renderVideo;
