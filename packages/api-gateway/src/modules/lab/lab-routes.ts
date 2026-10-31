import express, { type Router } from 'express';
import { validate } from 'shared/utils/validate';
import { authenticateTokens } from '../../middleware/authenticate-tokens';
import { handleCreateLab, handleGetLabStatus } from './lab-controller';
import { createLabSchema } from './lab-schema';

const labRoutes: Router = express.Router();

labRoutes.post('/create', authenticateTokens, validate(createLabSchema), handleCreateLab);

labRoutes.get('/:labId/status', authenticateTokens, handleGetLabStatus);

export { labRoutes };
