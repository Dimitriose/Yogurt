/**
 * Embeds the icon and metadata into Yogurt.exe after packaging.
 *
 * electron-builder normally does this itself, but here `signAndEditExecutable`
 * is off (see electron-builder.yml): that step downloads the winCodeSign
 * toolchain, whose extraction fails without permission to create symlinks.
 * Result: the .exe came out with Electron's default icon, and so did the
 * desktop shortcut — which points at the .exe.
 *
 * The npm `rcedit` package ships the same binary electron-builder would use,
 * but without symlinks, so it works on a regular user account.
 */
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const { rcedit } = await import('rcedit')
  const info = context.packager.appInfo
  const exe = join(context.appOutDir, `${info.productFilename}.exe`)

  await rcedit(exe, {
    icon: join(context.packager.info.buildResourcesDir, 'icon.ico'),
    'file-version': info.shortVersion || info.version,
    'product-version': info.shortVersionWindows || info.version,
    'version-string': {
      ProductName: info.productName,
      FileDescription: info.productName,
      CompanyName: info.companyName || 'Dimitriose',
      LegalCopyright: info.copyright,
      OriginalFilename: `${info.productFilename}.exe`
    }
  })
  console.log(`  • icon and metadata embedded in ${exe}`)
}
