import entries from '../../../public/catalog/characters.json';
export interface CharacterRecord {id:string;name:string;asset:string;height:number;boundsRadius:number}
export const CHARACTERS:CharacterRecord[] = entries.map(({id,name,asset,height,boundsRadius})=>({id,name,asset,height,boundsRadius}));
export function findCharacter(id:string):CharacterRecord{return CHARACTERS.find(x=>x.id===id)??CHARACTERS[0];}
