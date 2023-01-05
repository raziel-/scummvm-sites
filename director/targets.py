import json
import os.path
from dataclasses import dataclass, fields

from buildbot.config import BuilderConfig
from buildbot.plugins import steps, util

from .build_factory import default_env
from .env import settings
from .steps import ScummVMTest, download_step


@dataclass(frozen=True)
class TestTarget:
    name: str
    directory: str
    game_id: str
    platform: str
    version: str
    movienames: list[str]
    debugflags: str = "fewframesonly,fast"

    @property
    def builder_name(self) -> str:
        return f"{self.name}:{self.platform} ({self.version})"


# use the order defined in TestTarget
target_fields = [f.name for f in fields(TestTarget)]

# The JSON is specified as follows:
"""
[
    {
        "name": "Spaceship Warlock",
        "directory": "warlock-win",
        "game_id": "warlock-win",
        "platform": "win",
        "version": "D3",
        "debugflags": "fewframesonly,fast",
        "movienames": [
            "ASTERODS/ABOUT.MMM", .....]
    }
]
"""

test_targets = []
cwd = settings["TARGETS_BASEDIR"]
with open(os.path.join(cwd, "targets.json"), "r") as data:
    targets = json.loads(data.read())
    for target in targets:
        test_targets.append(
            TestTarget(**{name: target[name] for name in target_fields})
        )


def generate_command(target: TestTarget, moviename: str) -> list[str]:
    command = [
        "../scummvm",
        "-c",
        "scummvm.conf",
        f"--start-movie={moviename}",
    ]
    if target.debugflags:
        command.append(f"--debugflags={target.debugflags}")
    command.append(target.game_id)
    return command


def generate_builder(target: TestTarget, workernames: list[str]) -> BuilderConfig:
    factory = util.BuildFactory()
    factory.addStep(download_step)
    base_dir = settings["TARGETS_BASEDIR"]
    to_directory = target.directory
    if not to_directory.endswith("/"):
        to_directory += "/"
    factory.addStep(
        steps.ShellCommand(
            name="rsync",
            description="Synchronise files with store",
            command=[
                "rsync",
                "-av",
                "--delete",
                os.path.join(base_dir, to_directory),
                target.directory,
            ],
            logEnviron=False,
        )
    )
    for moviename in target.movienames:
        factory.addStep(
            ScummVMTest(
                name=moviename,
                description=moviename,
                descriptionDone=moviename,
                command=generate_command(target, moviename),
                env=default_env,
                workdir=os.path.join("build", target.directory),
                timeout=20,
                maxTime=30,
                interruptSignal="QUIT",
                logEnviron=False,
            )
        )

    return BuilderConfig(
        name=target.builder_name, workernames=workernames, factory=factory
    )