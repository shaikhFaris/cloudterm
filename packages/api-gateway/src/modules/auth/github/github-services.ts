import { db } from 'shared/db/drizzle';
import { ApiError } from 'shared/utils/ApiError';
import { createSession } from '../auth-services';
import { getGithubIdentity } from './github-client';
import { addGithubUser, findUserByGithubId } from './github-repository';

export const loginWithGithub = async (code: string, verifier: string) => {
  const { githubId, email } = await getGithubIdentity(code, verifier);
  return db.transaction(async (tx) => {
    const user = await findUserByGithubId(tx, githubId)
      ?? await addGithubUser(tx, githubId, email)
      ?? await findUserByGithubId(tx, githubId);
    if (!user) throw new ApiError(409, 'An account with this email already exists. Please use your existing login.');
    return createSession(tx, user);
  });
};
