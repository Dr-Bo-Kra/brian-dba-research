import { handleVercelSubmissionRequest } from './_vercel.mjs';

export const config = {
  maxDuration: 15,
};

export default async function handler(req, res) {
  await handleVercelSubmissionRequest(req, res);
}
