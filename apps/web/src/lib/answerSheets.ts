/** In-memory store for answer-sheet images between the upload and analysis steps.
 *
 * Files can't travel in the URL, so the upload page stashes the picked
 * File objects here (keyed by exam + student) and the analysis page reads
 * them back. Cleared when replaced; lost on full app reload — the analysis
 * page then asks the teacher to go back and re-pick the images.
 */

const store = new Map<string, File[]>();

export function sheetKey(examId: number, studentIdx: number): string {
  return `${examId}:${studentIdx}`;
}

export function setAnswerSheets(key: string, files: File[]) {
  store.set(key, [...files]);
}

export function getAnswerSheets(key: string): File[] {
  return store.get(key) ?? [];
}

export function clearAnswerSheets(key: string) {
  store.delete(key);
}
