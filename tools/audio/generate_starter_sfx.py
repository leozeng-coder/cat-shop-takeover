"""Render short game effects from CC0 audio (numpy, scipy and av required)."""

from __future__ import annotations

import argparse
from fractions import Fraction
import hashlib
import io
import json
from pathlib import Path
import subprocess
from urllib.request import Request, urlopen
import wave
import zipfile

import av
import numpy as np
from scipy.signal import butter, resample_poly, sosfilt


SAMPLE_RATE = 44100
PROJECT = Path(__file__).resolve().parents[2]
# The publisher pages identify these sources as CC0. Original files stay in
# admin history; the shared runtime directory contains only rendered WAV assets.
SOURCES = {
    "impact": {
        "page": "https://kenney.nl/assets/impact-sounds",
        "url": "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip",
        "file": "kenney-impact.zip",
        "sha256": "029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8",
    },
    "wood": {
        "page": "https://opengameart.org/content/35-wooden-crackshitsdestructions",
        "url": "https://opengameart.org/sites/default/files/independent_nu_ljudbank-wood_crack_hit_destruction.7z",
        "file": "wood-cracks.7z",
        "sha256": "2f9723be0147c32ea07db8ef7406229fb8f1a6ce8feabdf0dbf2dc5ee2aacd1a",
    },
    "slidepop": {
        "page": "https://opengameart.org/content/a-slide-pop-sound",
        "url": "https://opengameart.org/sites/default/files/slidepop_0.mp3",
        "file": "slidepop.mp3",
        "sha256": "dc82715e30b0296c49c9598942b00e5ad8853b16a0f23c71b1c782fdac854147",
    },
    "door_knocking": {
        "page": "https://freesound.org/people/altfuture/sounds/174640/",
        "url": "https://cdn.freesound.org/previews/174/174640_3015949-hq.mp3",
        "file": "door-knocking-altfuture.mp3",
        "sha256": "d3a598b65287f01bb44824e83d6ad25f6b51a1f3a29e09864546da30ffa53e21",
    },
    "bag_rustle": {
        "page": "https://freesound.org/people/memuse/sounds/264430/",
        "url": "https://cdn.freesound.org/previews/264/264430_1028547-hq.mp3",
        "file": "plastic-bag-memuse.mp3",
        "sha256": "ae9e216b78ada2a9bb4ae0c2d8cbc1a26d38cb0b39e94cba14b7a98ae124eaa5",
    },
    "tin_cans": {
        "page": "https://freesound.org/people/redcheek/sounds/235425/",
        "url": "https://cdn.freesound.org/previews/235/235425_3943504-hq.mp3",
        "file": "tin-cans-redcheek.mp3",
        "sha256": "a66fc590b9f8283f564bda3cae69d066b11ec453d3d478a6828f81b01d8a7e2b",
    },
}


def source_archive(key: str, cache: Path) -> Path:
    source = SOURCES[key]
    path = cache / source["file"]
    if path.exists():
        data = path.read_bytes()
    else:
        request = Request(source["url"], headers={"User-Agent": "CatShopAudioBuilder/1.0"})
        with urlopen(request, timeout=30) as response:
            data = response.read(30 * 1024 * 1024 + 1)
        if len(data) > 30 * 1024 * 1024:
            raise ValueError("Source archive exceeds the download limit")
    if hashlib.sha256(data).hexdigest() != source["sha256"]:
        raise ValueError(f"Source archive checksum changed: {path.name}")
    if not path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return path


def decode(data: bytes) -> np.ndarray:
    parts = []
    with av.open(io.BytesIO(data)) as container:
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
        for frame in container.decode(audio=0):
            parts.extend(out.to_ndarray()[0] for out in resampler.resample(frame))
        parts.extend(out.to_ndarray()[0] for out in resampler.resample(None))
    if not parts:
        raise ValueError("Audio source contains no samples")
    # Keep floating point headroom when downmixing; normalize only after mixing.
    return np.concatenate(parts).astype(np.float64)


def taper(signal: np.ndarray, attack: float, release: float) -> np.ndarray:
    signal = signal.copy()
    fade_in = min(len(signal), max(2, round(attack * SAMPLE_RATE)))
    fade_out = min(len(signal), max(2, round(release * SAMPLE_RATE)))
    signal[:fade_in] *= np.sin(np.linspace(0, np.pi / 2, fade_in)) ** 2
    signal[-fade_out:] *= np.cos(np.linspace(0, np.pi / 2, fade_out)) ** 2
    return signal


def fragment(signal: np.ndarray, start: float, end: float, *, speed: float = 1,
             low: float = 100, high: float = 5000, release: float = 0.01,
             attack: float = 0.0005) -> np.ndarray:
    first, last = round(start * SAMPLE_RATE), round(end * SAMPLE_RATE)
    if first < 0 or last > len(signal) or first >= last:
        raise ValueError("Invalid source fragment")
    result = signal[first:last].copy()
    result -= np.mean(result)
    if speed != 1:
        ratio = Fraction(1 / speed).limit_denominator(1000)
        result = resample_poly(result, ratio.numerator, ratio.denominator)
    eq = butter(2, [low, high], btype="bandpass", fs=SAMPLE_RATE, output="sos")
    result = taper(sosfilt(eq, result), attack, release)
    peak = np.max(np.abs(result))
    if not np.isfinite(peak) or peak < 1e-8:
        raise ValueError("Source fragment is empty or invalid")
    return result / peak


def add_at(mix: np.ndarray, voice: np.ndarray, seconds: float, gain: float = 1) -> None:
    start = round(seconds * SAMPLE_RATE)
    if start < 0 or start + len(voice) > len(mix):
        raise ValueError("The mix would truncate a source fragment")
    mix[start:start + len(voice)] += voice * gain


def recipes(cache: Path) -> list[tuple]:
    impact = source_archive("impact", cache)
    wood = source_archive("wood", cache)
    with zipfile.ZipFile(impact) as archive:
        light = decode(archive.read("Audio/impactWood_light_000.ogg"))
        light_alt = decode(archive.read("Audio/impactWood_light_001.ogg"))
        medium = decode(archive.read("Audio/impactWood_medium_000.ogg"))
        heavy = decode(archive.read("Audio/impactWood_heavy_000.ogg"))
        metal = decode(archive.read("Audio/impactMetal_light_000.ogg"))
    # Read one known member to stdout, without extracting archive paths to disk.
    crack = decode(subprocess.check_output(
        ["tar", "-xOf", str(wood), "wood_impact/crack10.mp3.flac"], timeout=30))

    button = fragment(light, 0, 0.055, speed=0.88, low=240, high=3800, release=0.012)

    # Short assembly clicks and one rounded latch with a quiet bright edge.
    # No musical scale, synthesized chirps, reverb or repeated tail.
    upgrade = np.zeros(round(0.235 * SAMPLE_RATE))
    add_at(upgrade, fragment(light_alt, 0, 0.040, high=3600), 0, 0.34)
    add_at(upgrade, fragment(light, 0, 0.045, high=4000), 0.045, 0.46)
    add_at(upgrade, fragment(medium, 0, 0.090, speed=0.9, high=4200, release=0.018), 0.100, 0.90)
    add_at(upgrade, fragment(metal, 0, 0.110, low=1100, high=6200, release=0.025), 0.115, 0.13)

    # One contact only. Do not append door-panel vibration or a second knock.
    knock = fragment(heavy, 0, 0.085, speed=0.9, low=110, high=2800, release=0.018)

    # Isolate the fracture, excluding the later independent impact at 0.559 s.
    # door.hit plays on the breaking hit, so don't add another thump.
    broken = fragment(crack, 0.150, 0.320, low=100, high=6000,
                      attack=0.002, release=0.020)
    return [
        ("button", "拟音·按钮轻扣", "ui", "ui.click", button, -9),
        ("upgrade", "拟音·升级扣合", "item", "item.upgrade", upgrade, -8),
        ("knock", "拟音·敲门单击", "door", "door.hit", knock, -8),
        ("break", "拟音·破门断裂", "door", "door.break", broken, -8),
    ]


def encode(signal: np.ndarray, peak_db: float) -> tuple[bytes, dict]:
    # A sub-millisecond edge fade preserves each recipe's intended envelope.
    signal = taper(signal - np.mean(signal), 0.0003, 0.001)
    peak = np.max(np.abs(signal))
    if not np.all(np.isfinite(signal)) or peak < 1e-8:
        raise ValueError("The rendered audio is empty or invalid")
    signal *= 10 ** (peak_db / 20) / peak
    pcm = np.rint(signal * 32767).astype("<i2")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())
    stats = {"duration": round(signal.size / SAMPLE_RATE, 3),
             "peakDb": round(20 * np.log10(np.max(np.abs(signal))), 2),
             "rmsDb": round(20 * np.log10(np.sqrt(np.mean(signal ** 2))), 2)}
    return output.getvalue(), stats


def launcher_recipe(cache: Path) -> tuple:
    source = decode(source_archive("slidepop", cache).read_bytes())
    # Keep only the final brief slide and release. A short onset keeps the pop
    # aligned with item.fire; a soft high cut reduces repeated-shot harshness.
    launch = fragment(source, 0.340, 0.530, speed=1.06, low=200, high=4500, attack=0.003, release=0.018)
    return ("launcher", "拟音·轻巧弹射", "item", "item.fire", launch, -10)


def knock_variant_recipes(cache: Path) -> list[tuple]:
    # altfuture's CC0 public preview contains repeated real door knocks. These
    # windows isolate individual contacts before the late rattle/next knock.
    door = decode(source_archive("door_knocking", cache).read_bytes())
    with zipfile.ZipFile(source_archive("impact", cache)) as archive:
        wood = decode(archive.read("Audio/impactWood_medium_002.ogg"))
        soft = decode(archive.read("Audio/impactSoft_heavy_000.ogg"))
        plank = decode(archive.read("Audio/impactPlank_medium_000.ogg"))

    # A: rounded, short low-mid body; lift the soft impact above sub-bass so
    # small speakers still reproduce the weight. Both layers share one onset.
    rounded = np.zeros(round(0.180 * SAMPLE_RATE))
    add_at(rounded, fragment(wood, 0, 0.140, speed=0.84, low=110, high=1300, attack=0.002, release=0.035), 0, 0.65)
    add_at(rounded, fragment(soft, 0, 0.210, speed=1.8, low=100, high=850, attack=0.003, release=0.025), 0, 0.75)
    rounded = np.tanh(rounded * 1.25)

    # B: dry knuckle contact, preserving the wood's midrange texture.
    wooden = fragment(door, 1.367, 1.478, speed=1.08, low=300, high=5200, attack=0.001, release=0.027)

    # C: a broader, lower real impact plus a simultaneous plank attack.
    # No delayed layers, door-panel vibration, reverberation or debris sounds.
    forceful = np.zeros(round(0.185 * SAMPLE_RATE))
    add_at(forceful, fragment(door, 1.837, 1.997, speed=0.90, low=100, high=3600, attack=0.001, release=0.040), 0, 0.90)
    add_at(forceful, fragment(plank, 0, 0.110, speed=0.90, low=120, high=2800, attack=0.001, release=0.030), 0, 0.40)
    forceful = np.tanh(forceful * 1.6)

    # Comparable peak levels let listeners compare timbre, not just loudness.
    return [
        ("knock_round", "敲门A·卡通闷咚", "door", "door.hit", rounded, -8),
        ("knock_wood", "敲门B·木质笃", "door", "door.hit", wooden, -8),
        ("knock_heavy", "敲门C·重撞砰", "door", "door.hit", forceful, -8),
    ]


def trash_variant_recipes(cache: Path) -> list[tuple]:
    bag = decode(source_archive("bag_rustle", cache).read_bytes())
    cans = decode(source_archive("tin_cans", cache).read_bytes())
    with zipfile.ZipFile(source_archive("impact", cache)) as archive:
        wood = decode(archive.read("Audio/impactWood_light_001.ogg"))
        soft = decode(archive.read("Audio/impactSoft_medium_000.ogg"))

    # Two distinct rummaging gestures, matching the two 600 ms shake cycles.
    # Finish before the current 1200 ms reveal; no reveal chime or final accent.
    paper = np.zeros(round(1.150 * SAMPLE_RATE))
    add_at(paper, fragment(bag, 14.05, 14.56, speed=1.08, low=380, high=4800, attack=0.035, release=0.095), 0.020, 0.85)
    add_at(paper, fragment(bag, 14.85, 15.37, speed=1.08, low=380, high=4500, attack=0.040, release=0.105), 0.620, 0.95)

    # Actual cans shifting inside a bag. Remove sharp high-frequency clatter
    # while preserving a few small irregular contacts within each gesture.
    tins = np.zeros_like(paper)
    add_at(tins, fragment(cans, 6.96, 7.48, speed=1.08, low=240, high=3700, attack=0.025, release=0.095), 0.020, 0.82)
    add_at(tins, fragment(cans, 10.46, 10.98, speed=1.08, low=240, high=3700, attack=0.025, release=0.105), 0.620, 0.90)

    # A warmer toy-bin character: softened rummaging plus restrained hollow
    # contacts during each shake, with no contact after the second gesture.
    cartoon = np.zeros_like(paper)
    add_at(cartoon, fragment(cans, 0.88, 1.32, speed=0.95, low=160, high=2100, attack=0.045, release=0.110), 0.035, 0.75)
    add_at(cartoon, fragment(cans, 14.23, 14.70, speed=1.0, low=160, high=2300, attack=0.045, release=0.110), 0.625, 0.83)
    for when, gain in [(0.100, 0.20), (0.280, 0.13), (0.700, 0.22), (0.900, 0.12)]:
        add_at(cartoon, fragment(wood, 0, 0.060, speed=0.80, low=160, high=1800, attack=0.002, release=0.025), when, gain)
    for when in [0.110, 0.710]:
        add_at(cartoon, fragment(soft, 0, 0.090, speed=1.65, low=110, high=900, attack=0.003, release=0.020), when, 0.17)
    cartoon = np.tanh(cartoon * 1.2)

    # These belong to installation of magic_trash_bin, never item.reveal.
    return [
        ("trash_paper", "垃圾桶A·纸袋翻找", "item", "item.install", paper, -10),
        ("trash_tins", "垃圾桶B·罐头轻碰", "item", "item.install", tins, -10),
        ("trash_cartoon", "垃圾桶C·卡通摇桶", "item", "item.install", cartoon, -10),
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=PROJECT / "assets/audio/files")
    parser.add_argument("--source-cache", type=Path,
                        default=PROJECT / "client-admin/data/audio/sources")
    parser.add_argument("--only", choices=["button", "upgrade", "knock", "break", "launcher", "knock-variants", "trash-variants"])
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    clips = []
    cache = args.source_cache.resolve()
    if args.only == "knock-variants":
        selected = knock_variant_recipes(cache)
    elif args.only == "trash-variants":
        selected = trash_variant_recipes(cache)
    else:
        selected = [] if args.only == "launcher" else recipes(cache)
        if args.only in (None, "launcher"):
            selected.append(launcher_recipe(cache))
    for key, name, category, event, signal, peak_db in selected:
        if args.only not in (None, "knock-variants", "trash-variants") and key != args.only:
            continue
        data, stats = encode(signal, peak_db)
        filename = hashlib.sha256(data).hexdigest().upper() + ".wav"
        destination = output / filename
        if destination.exists():
            if destination.read_bytes() != data:
                raise ValueError(f"Refusing to overwrite different audio: {destination}")
        else:
            destination.write_bytes(data)
        clips.append({"key": key, "name": name, "category": category, "event": event,
                      "file": filename, "path": str(destination), "bytes": len(data), **stats})
        if key.startswith("trash_"):
            clips[-1]["target"] = "magic_trash_bin"
    print(json.dumps(clips, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
