import { characterSchema, createSprite } from "@fungi.computer/sprite";
import renderVideo from "@fungi.computer/sprite/video";

const character = characterSchema.parse(
  JSON.parse(
    JSON.stringify({
      version: 1,
      name: "stranger",
      renderer: "video",
      controls: {},
      data: { clips: { idle: "idle.mp4" } },
    }),
  ),
);
if (character.name !== "stranger") {
  throw new Error("Packed Sprite data/service contract is missing");
}
createSprite({});
void renderVideo;
