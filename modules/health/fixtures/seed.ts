// Rows for the seeded Space: the services the supervisor reports. Ids and counts only.
export const seed = {
  table: "health_service",
  rows: [
    { name: "gateway", state: "healthy", started_at: 1760000000000, restarts: 0 },
    { name: "scheduler", state: "healthy", started_at: 1760000000000, restarts: 0 },
    { name: "caddy", state: "healthy", started_at: 1760000000000, restarts: 0 },
  ],
};
