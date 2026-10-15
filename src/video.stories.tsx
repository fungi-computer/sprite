import { useState } from "react";
import { createSprite, type PlayerState } from "./index.js";
import { Sprite } from "./react.js";

const activities = [
  { id: "idle", label: "Idle", clip: "Portrait" },
  { id: "thinking", label: "Thinking", clip: "At the computer" },
  { id: "speaking", label: "Streaming", clip: "Portrait" },
] as const;

const service = createSprite({
  assets: {
    baseURL: window.location.href,
    allowedOrigins: [window.location.origin],
    maxBytes: 2_000_000,
    maxTotalBytes: 4_000_000,
    maxRequests: 4,
  },
  renderers: {},
  characters: {
    muse: async () => ({
      document: {
        version: 1 as const,
        name: "Muse mushroom",
        renderer: "video",
        poster: "/media/muse-mushroom-portrait.png",
        controls: {},
        data: {
          clips: {
            idle: "/media/muse-mushroom-portrait.mp4",
            thinking: "/media/muse-mushroom-working.mp4",
            speaking: "/media/muse-mushroom-portrait.mp4",
          },
        },
      },
      render: (await import("./video.js")).default,
    }),
  },
});

export default { title: "Sprite / Media" };

export const MuseVideo = () => {
  const [selected, setSelected] = useState<(typeof activities)[number]>(
    activities[0],
  );
  const [state, setState] = useState<PlayerState["status"]>("empty");
  return (
    <main
      style={{
        display: "grid",
        gap: 20,
        justifyItems: "center",
        minHeight: "100vh",
        padding: 32,
        background: "#f0f2fb",
        color: "#363b50",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ width: "min(100%, 540px)" }}>
        <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.15em" }}>
          SPRITE / NATIVE VIDEO
        </p>
        <h1 style={{ margin: "4px 0 8px" }}>Muse mushroom</h1>
        <p style={{ margin: 0 }}>
          One Sprite character, two Muse clips. These controls send activity
          changes; Sprite selects the clip without changing its source.
        </p>
      </div>
      <section
        aria-label="Muse avatar preview"
        style={{
          width: "min(100%, 540px)",
          padding: 16,
          border: "2px solid #51596c",
          borderRadius: 24,
          background: "#fff",
          boxShadow: "0 8px 0 #cbd0df",
        }}
      >
        <Sprite
          src={{ local: "muse" }}
          service={service}
          activity={selected.id}
          role="img"
          aria-label={`Muse mushroom avatar, ${selected.label.toLowerCase()}`}
          onState={(next) => {
            setState(next.status);
          }}
          data-testid="muse-video-avatar"
          style={{ width: "100%", aspectRatio: "1", overflow: "hidden" }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 4px 0",
          }}
        >
          <strong>
            {selected.label} · {selected.clip}
          </strong>
          <small data-testid="muse-video-state">{state}</small>
        </div>
      </section>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {activities.map((activity) => (
          <button
            key={activity.id}
            type="button"
            aria-pressed={selected.id === activity.id}
            onClick={() => {
              setSelected(activity);
            }}
            style={{
              border: "1px solid #51596c",
              borderRadius: 10,
              padding: "10px 16px",
              background: selected.id === activity.id ? "#51596c" : "#fff",
              color: selected.id === activity.id ? "#fff" : "#363b50",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            {activity.label}
          </button>
        ))}
      </div>
    </main>
  );
};
