import { ImportCommand } from './import.command';
import { BasicCommand } from './basic.command';

import { ClearCommand } from './clear.command';

export const CommandProviders = [ImportCommand, BasicCommand, ClearCommand];
