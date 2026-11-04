// The short handle an agent uses for a person: their first name in lower case and four characters of their id ("aliza-0c6"). Tools resolve it; the model names people and never reads ids.
export const handleOf = (name: string, id: string): string => `${(name.split(" ")[0] || name).toLowerCase().replace(/[^a-z0-9]+/g, "") || "person"}-${id.replace(/^usr_/, "").slice(-4)}`;
