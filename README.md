# MUSIC BOX ONLINE · 3D Room Reconstruction (Phase 1 & 2)

**This project contains real 3D geometry in GLB files.** It does not use an HTML image backdrop as a substitute for the room. There is precisely **one room**, designed with **20 seat anchors**. The pink musical door is a **printed mural on the right wall**, not a 3D door.

> **Important verification limitation:** GLB assets and CPU reference renders were created and re-opened in the current environment. Blender and npm registry are not accessible in that environment, so a `.blend` file was **not generated**, and `npm install` / `npm run build` / real WebGL/mobile testing **have not been verified**. The Blender import script is provided, but its output must be generated on a machine with Blender. See `docs/QA_REPORT.md`.

## Included result

- Complete edited Next.js App Router / TypeScript / React Three Fiber website source.
- Real sculpted/meshed GLBs for **25 independent architectural/furniture/decor assets** and one assembled room GLB.
- Optimized room GLB for web with **25 geometry groups** versus **663** in the unoptimized model.
- **20 new Plush Chibi GLBs**, with compatible transform nodes for procedural Idle/Walk/Run/Sit/Jump/Wave/Dance.
- Floor plan, 20 seat anchors, TV physical screen plane, camera settings, collision and interactions.
- Editable room/character generation Python scripts, an import-to-Blender script and images rendered directly from actual GLB triangles.
- Unit tests for movement, 20 seating transitions, seated directions, and collisions.

## Install and run on Windows

Install Node.js 22+ and open a PowerShell terminal in the extracted project directory:

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`. Alternatively run `START_WINDOWS.bat`.

To test on an Android/iPhone connected to the same Wi-Fi as the PC, use `http://<PC-LAN-IP>:3000` and allow Windows Firewall access to port 3000. Mobile joystick appears automatically for coarse pointers. The browser device tests still have to be performed locally.

Run quality checks:

```powershell
npm.cmd run validate:assets
npm.cmd run validate:room
npm.cmd run test
npm.cmd run typecheck
npm.cmd run build
```

`npm run test` and `npm run validate:room` can run without a network connection, but `typecheck` and `build` require the npm packages to be installed.

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Walk | WASD / Arrow keys | Virtual joystick |
| Run | Hold Shift | Hold Run |
| Camera orbit | Click-drag | Swipe on 3D area |
| Camera zoom | Mouse wheel | Pinch gesture |
| Interact / sit / stand | E | Contextual interaction button |
| Jump | Space | Jump button |
| TV focus | F near TV | Focus button near TV |
| Wave / dance | Working HUD buttons | Working HUD buttons |
| Reset avatar | HUD button | HUD button |

A seat interaction **moves the avatar to an approach position**, turns smoothly to face away from the backrest, lowers into a `sit` pose and allows standing again. The closest valid free seat within interaction range is selected. The controls are intentionally disabled during transit. There is no multiplayer or microphone implementation at this phase.

## Directory structure

```text
assets3d/
  source/
    generate_assets.py           # Procedural real 3D room GLBs + manifest
    generate_plush_characters.py # 20 genuinely new GLB chibi characters
    optimize_glb.py              # Combine static draw calls by PBR material
    render_geometry.py           # CPU render directly from GLB triangles
    create_review_previews.py    # Preview comparison and floor plan
    blender_import.py           # Import room GLB, edit, save actual .blend
    blender_import_characters.py# Import 20 avatars as Blender projects
    requirements.txt
  objects/                       # 25 independent asset GLBs
  assembled/
    music_box_room.glb           # Room as separate geometry nodes
    music_box_room_optimized.glb # Web runtime room model
  textures/                      # Night cherry blossom, printed door, TV preview
  previews/                      # Reference camera, overview, avatars, QA plans
  manifest.json                  # All 35 object instances + 20 anchors
  asset_validation.json          # Re-import geometry checks
public/
  models/room/                   # Optimized room GLB and TV preview
  models/plush/                  # 20 new character GLBs
  models/chibi/                  # Original backup character GLBs
  catalog/characters.json       # Active plush roster
src/
  app/                           # Next.js App Router + CSS
  components/                    # HUD, responsive joystick, Canvas
  game/
    assets/                      # AssetManager and RoomLoader
    actors/                      # Character rig animation
    controllers/                 # Seat, camera, collision and interaction
    core/                        # Input math and movement constants
    data/                        # Manifest and types
    ports/                       # Pure interface hooks for future backend
    GameWorld.tsx                # WebGL loop, camera and action orchestration
tests/                            # Node logic/asset tests
 docs/                            # Specifications and QA report
```

## Rebuilding real 3D assets

Python 3.10+ is required. In Windows PowerShell:

```powershell
py -m pip install -r assets3d/source/requirements.txt
py assets3d/source/generate_assets.py
py assets3d/source/optimize_glb.py
py assets3d/source/generate_plush_characters.py
py assets3d/source/render_geometry.py
```

Then copy the re-exported runtime GLB to `public/models/room/music_box_room_optimized.glb` and the manifest to `src/game/data/roomManifest.json` when making design changes.

For editable Blender source, install Blender 4.x and run in the project directory:

```powershell
& "C:\Program Files\Blender Foundation\Blender 4.4\blender.exe" --background --python assets3d/source/blender_import.py
& "C:\Program Files\Blender Foundation\Blender 4.4\blender.exe" --background --python assets3d/source/blender_import_characters.py
```

Adjust the Blender executable path to the installed version. The first command creates `assets3d/source/music_box_room.blend`, and the second creates 20 character `.blend` files under `assets3d/source/character_blend/`. **These output files have not been produced or verified in the current environment.**

## Vercel Hobby deployment

The web app uses no paid APIs or server state. After a successful `npm run build`, import this folder into a Vercel project using Framework Preset **Next.js**. Use the standard install and build commands (`npm install`, `npm run build`). Static GLB files are served from `public/models/`. Keep the image assets and model paths in the repository. No environment variables are required until later phases.

## Future adapters

`src/game/ports/GameBridge.ts` defines interfaces for future room movement events and playback, but the production GameWorld currently publishes them to a local no-op adapter. The TV is a distinct 16:9 screen surface for a later YouTube IFrame Player; no YouTube audio/iframe is faked in this stage. There is no Supabase/LiveKit integration.

## Accuracy disclosure

The room is reconstructed from **one perspective image**. Hidden areas, exact dimensions, fabric weave, and lighting properties cannot be established from that single image. The generated meshes match the major spatial arrangement and pastel materials, but the software-rendered preview is noticeably simpler than the highly detailed illustrated reference. This is a usable first 3D reconstruction, **not a certified pixel-identical remake**. Blender Cycles render comparison and real device inspection remain pending.


## V3 dual size and textures
See [TEXTURE_INTEGRATION.md](TEXTURE_INTEGRATION.md).
