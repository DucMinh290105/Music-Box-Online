import type {Metadata,Viewport} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Music Box Online | Room Lab',description:'Playable pastel 3D music room prototype. Local-only Phase 1 & 2.'};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#f9edf0'};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="vi"><body>{children}</body></html>;
}
