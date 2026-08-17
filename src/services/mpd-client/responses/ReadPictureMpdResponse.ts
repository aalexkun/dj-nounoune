import { BinaryMpdResponse } from './BinaryMpdResponse';

/** Reply of `readpicture` — the picture stored inside the file itself (ID3 APIC, FLAC PICTURE). */
export class ReadPictureMpdResponse extends BinaryMpdResponse {}
