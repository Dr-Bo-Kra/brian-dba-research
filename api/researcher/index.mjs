import { handleVercelResearcherRequest } from './_vercel.mjs';

export const config = {
  maxDuration: 15,
};

export default async function handler(req, res) {
  await handleVercelResearcherRequest(req, res);
}
