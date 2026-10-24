// health: rows for the seeded Space. The small recipe finds this file by glob.
export const seed = {
  table: 'health_service',
  rows: [
    { name: 'caddy', state: 'healthy', started_at: 1760000000000, restarts: 0 },
    { name: 'docker', state: 'healthy', started_at: 1760000000000, restarts: 0 },
    { name: 'gateway', state: 'healthy', started_at: 1760000000000, restarts: 0 },
    { name: 'scheduler', state: 'healthy', started_at: 1760000000000, restarts: 0 },
  ],
};
