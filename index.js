#!/usr/bin/env node

'use strict';

const fs = require('fs');
const glob = require("glob");
const { ArgumentParser } = require('argparse');
const { version } = require('./package.json');
const { mainModule } = require('process');
const xpath = require('xpath')
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')

const parser = new ArgumentParser({
  description: 'get/set/bump/compare the current version to a given package reference in a given .csproj',
  add_help: true,
});

parser.add_argument('-v', '--version', { help: 'print package reference version and exit', action: 'version', version });

const subparsers = parser.add_subparsers({
    title: 'actions',
    dest: 'subcommand',
    help:'action to execute'
})

const get_parser = subparsers.add_parser('get',   {aliases: ['g'], help: 'gets the current version of a given package reference in a given .csproj' })
const set_parser = subparsers.add_parser('set',   {aliases: ['s'], help: 'sets the current version of a given package reference in a given .csproj' })
const bump_parser = subparsers.add_parser('bump', {aliases: ['b'], help: 'bumps the current version of a given package reference in a given .csproj' })
const cmp_parser = subparsers.add_parser('cmp',   {aliases: ['c'], help: 'compare the current version of a given package reference in a given .csproj' })

const parsers = [get_parser, set_parser, bump_parser, cmp_parser]

parsers.forEach(p => {
    p.add_argument('-r', '--regex', {
        help: `ECMAScript Regular Expression to parse the version string for verification.
Defaults to being semver, i.e. "major.minor.patch"
Set if you to be compatible with a different, non-semver format.`,
        type: String,
        default: '^(?<major>0|[1-9]\\d*)\\.(?<minor>0|[1-9]\\d*)(\\.(?<patch>0|[1-9]\\d*))?(?:-(?<prerelease>(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+(?<buildmetadata>[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$'
    })

    p.add_argument('-d', '--package', { help: 'Dependency package name.', type: String, required: true })
    p.add_argument('-x', '--xpath', { help: 'XPath to version element.', type: String, default: '//ItemGroup/PackageReference[@Include="\$1"]/@Version' })
    p.add_argument('files', { help: 'the .csproj files from which to read/write the version.', nargs: '+'})
})

set_parser.add_argument('-v', '--version', {
    help: 'the semver version to set; has to be compatible to the provided regex.',
    type: String,
    required: true
})


bump_parser.add_argument('-M', '--major', {
    help: 'bump the major revision.',
    action: 'store_true'
})
bump_parser.add_argument('-m', '--minor', {
    help: 'bump the minor revision.',
    action: 'store_true'
})
bump_parser.add_argument('-p', '--patch', {
    help: 'bump the patch revision.',
    action: 'store_true'
})

cmp_parser.add_argument('-v', '--version', {
    help: 'the semver version to compare to; has to be compatible to the provided regex.',
    type: String,
    required: true
})

const args = parser.parse_args();

async function run()
{
    // console.dir(args)
    switch(args.subcommand)
    {
        case 'get':  return get_version();
        case 'set':  return set_version();
        case 'bump': return bump_version();
        case 'cmp':  return compare_version();
    }
}
run();

function get_version()
{
    try
    {
        const doc = read_csproj(args.files);
        const verAttribute = get_csproj_package_version(doc);
        if (verAttribute)
        {
            const ver = parse_version(verAttribute.value);
            if (ver)
            {
                console.log(verAttribute.value);
            }
            else
            {
                console.error("failed to parse .csproj package reference version");
                return 1;
            }
        }
        else
        {
            console.error("invalid .csproj does not contain package reference version");
            return 1;
        }
    }
    catch (error)
    {
        console.error(error.message);
        return 1;
    }

    return 0;
}

function set_version()
{
    try
    {
        // console.dir(args)
        const doc = read_csproj(args.files);
        const verAttribute = get_csproj_package_version(doc);
        if (verAttribute)
        {
            const ver = parse_version(args.version);
            if (ver)
            {
                verAttribute.value = args.version;
                write_csproj(args.files, doc);
            }
            else
            {
                console.error("failed to parse .csproj package reference version");
                return 1;
            }
        }
        else
        {
            console.error("invalid .csproj does not contain package reference version");
            return 1;
        }

        // read back
        const doc2 = read_csproj(args.files);
        const verAttribute2 = get_csproj_package_version(doc2);
        if (verAttribute2)
        {
            const ver = parse_version(verAttribute2.value);
            if (ver)
            {
                console.log(verAttribute2.value);
            }
            else
            {
                console.error("failed to parse .csproj package reference version at read back");
                return 1;
            }

            if (verAttribute2.value === verAttribute.value)
            {
                // no issues
            }
            else
            {
                console.error("readback version different from input version");
                return 1;
            }
        }
        else
        {
            console.error("invalid .csproj does not contain package reference version at read back");
            return 1;
        }
    }
    catch (error)
    {
        console.error(error.message);
        return 1;
    }

    return 0;
}

function bump_version()
{
    try
    {
        const doc = read_csproj(args.files);
        const verAttribute = get_csproj_package_version(doc);
        if (verAttribute)
        {
            const ver = parse_version(verAttribute.value);
            if (ver)
            {
                let [major, minor, patch, prerelease, buildmetadata] = ver;
                // console.dir({ver});
                // console.dir({major, minor, patch, prerelease, buildmetadata});

                if (args.major)
                {
                    major++;
                }
                if (args.minor)
                {
                    minor++;
                }
                if (args.patch)
                {
                    patch++;
                }
                verAttribute.value = `${major}.${minor}.${patch}`;

                if (prerelease)
                {
                    verAttribute.value += `-${prerelease}`;
                }
                if (buildmetadata)
                {
                    verAttribute.value += `+${buildmetadata}`;
                }

                write_csproj(args.files, doc);
            }
            else
            {
                console.error("failed to parse .csproj package reference version");
                return 1;
            }
        }
        else
        {
            console.error("invalid .csproj does not contain package reference version");
            return 1;
        }

        // read back
        const doc2 = read_csproj(args.files);
        const verAttribute2 = get_csproj_package_version(doc2);
        if (verAttribute2)
        {
            const ver = parse_version(verAttribute2.value);
            if (ver)
            {
                console.log(verAttribute2.value);
            }
            else
            {
                console.error("failed to parse .csproj package reference version at read back");
                return 1;
            }

            if (verAttribute2.value === verAttribute.value)
            {
                // no issues
            }
            else
            {
                console.error("readback version different from input version");
                return 1;
            }
        }
        else
        {
            console.error("invalid .csproj does not contain package reference version at read back");
            return 1;
        }
    }
    catch (error)
    {
        console.error(error.message);
        return 1;
    }

    return 0;
}

function compare_version()
{
    try
    {
        const doc = read_csproj(args.files);
        const verAttribute = get_csproj_package_version(doc);
        if (verAttribute && verAttribute.value && args.version)
        {
            const cmp = compare_versions(args.version, verAttribute.value);
            console.log("%i", cmp);
        }
        else
        {
            console.error("invalid .csproj does not contain version");
            return 1;
        }
    }
    catch (error)
    {
        console.error(error.message);
        return 1;
    }

    return 0;
}

//-----------------------------------------------------------------------------

function parse_version(version)
{
    const match = version.match(args.regex);
    if (match)
    {
        // console.dir({groups: match.groups});
        return [match.groups.major, match.groups.minor, match.groups.patch, match.groups.prerelease, match.groups.buildmetadata];
    }
    return null
}

function get_csproj_package_version(doc)
{
    const xpath_selector = args.xpath.replace("\$1", args.package)
    // console.log(xpath_selector);
    const verAttribute = xpath.select(xpath_selector, doc);
    // console.log(verAttribute);

    if (verAttribute === undefined ||
        verAttribute.length == 0   ||
        verAttribute[0] === undefined)
    {
        throw Error("Could not locate version element. Check XPath expression or .csproj file");
    }

    if (verAttribute)
    {
        return verAttribute[0];
    }
    return null;
}

function read_csproj(csprojfile)
{
    const xml = fs.readFileSync(csprojfile, 'utf8');
    // console.log("%s", xml);

    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    // console.dir({doc});

    if (doc == null)
    {
        throw Error("error while parsing");
    }

    return doc;
}

function write_csproj(csprojfile, doc)
{
    const serializer = new XMLSerializer();
    const xml = serializer.serializeToString(doc);
    fs.writeFileSync(csprojfile, xml + '\n');
}


function compare_versions(version_A, version_B)
{
    const a_version = parse_version(version_A);
    if (a_version === null || a_version === undefined) throw(`failed to parse '{version_A}'`);
    let [a_major, a_minor, a_patch, a_prerelease, a_buildmetadata] = a_version;

    const b_version = parse_version(version_B);
    if (b_version === null || b_version === undefined) throw(`failed to parse '{version_B}'`);
    let [b_major, b_minor, b_patch, b_prerelease, b_buildmetadata] = b_version;

    if (a_major < b_major)
        return -1;
    else if(a_major > b_major)
        return 1;

    if (a_minor < b_minor)
        return -1;
    else if(a_minor > b_minor)
        return 1;

    if (a_patch < b_patch)
        return -1;
    else if(a_patch > b_patch)
        return 1;

    if (a_prerelease < b_prerelease)
        return -1;
    else if(a_prerelease > b_prerelease)
        return 1;

    if (a_buildmetadata < b_buildmetadata)
        return -1;
    else if(a_buildmetadata > b_buildmetadata)
        return 1;

    return 0;
}
