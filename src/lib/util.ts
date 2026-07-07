export function doiUrl(doi: string): string {
  return `https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//, "")}`;
}
