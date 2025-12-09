{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    crane.url = "github:ipetkov/crane";
    systems.url = "systems";
  };

  outputs = {
    nixpkgs,
    crane,
    systems,
    fenix,
    ...
  }: let
    eachSystem = f: nixpkgs.lib.genAttrs (import systems) (system: f nixpkgs.legacyPackages.${system});
  in {
    packages = eachSystem (pkgs: let
      craneLib = crane.mkLib pkgs;
    in {
      default = craneLib.buildPackage {
        src = craneLib.cleanCargoSource ./.;
      };
    });

    devShells = eachSystem ({pkgs, ...}: {
      default = let
        mkScript = name: text: let
          script = pkgs.writeShellScriptBin name text;
        in
          script;

        scripts = [
          (mkScript "dev" ''bacon run-long-release'')
        ];
      in
        pkgs.mkShell {
          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [pkgs.openssl];
          buildInputs = let
            f = fenix.packages.${pkgs.stdenv.hostPlatform.system};
          in
            [
              (f.complete.withComponents [
                "cargo"
                "clippy"
                "rust-src"
                "rustc"
                "rustfmt"
              ])
              pkgs.bacon
              pkgs.sqlx-cli
              pkgs.pkg-config
              pkgs.openssl
              pkgs.bun
            ]
            ++ scripts;
        };
    });
  };
}
