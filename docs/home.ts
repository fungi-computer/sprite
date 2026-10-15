import {
  avatarEnvelopeSchema,
  legacyAvatar,
} from "@fungi.computer/sprite/avatar";

const avatar = legacyAvatar("agent-42");
console.log(avatar.character, avatar.expression); // "mushroom" "normal"
console.log(avatarEnvelopeSchema.safeParse(avatar).success); // true
console.log(avatarEnvelopeSchema.safeParse({ v: 2 }).success); // false
