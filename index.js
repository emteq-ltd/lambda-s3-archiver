'use strict';

const aws = require('aws-sdk');
const archiver = require('archiver');
const { PassThrough } = require('stream');

const s3 = new aws.S3();

/*
 * @callback s3FileNameTransform
 * @param {s3File} - The fully qualified S3 object key
 * @return {string} - The custom formatted file name
 */

/*
 * This nodejs module will read and archive files in AWS S3 bucket using stream, and store the archived file in S3 as well..
 * @param {sourceBucket} - the S3 bucket containing the files to archive
 * @param {sourcePath} - the S3 prefix/path containing the files to archive. Include a trailing slash (e.g. mydir/) - DS.
 * @param {sourceFiles} - (OPTIONAL) the list of filenames in the sourcePath to archive
 *                      - If not specified, all the files in sourcePath will be included in the archive
 * @param {outputFilename} - the filename of the archive file. Default to 'archive'.
 * @param {outputFormat} - the format of the archive file (zip | tar). Default to 'zip'.
 * @param {uploadOptions} - additional options passed to s3.upload https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property
 * @param {Object} archiverOptions - options to configure how files are added to the archiver
 * @param {s3FileNameTransform} archiverOptions.s3FileNameTransform - callback to apply to each file key to generate custom file names for the final archive
 *
 * @return {object} - a JSON object containing the details of the archive file.
    {
        s3Bucket: 's3-bucket-name',
        fileKey: 's3-prefix-path/archive.zip',
        fileSize: 1024
    }
 */
const archive = (
  sourceBucket,
  sourcePathPrefix,
  sourceFiles = [],
  outputFilename = 'archive',
  outputFormat = 'zip',
  uploadOptions = {},
  archiverOptions = {},
) => {
    return new Promise(async (resolve, reject) => {
        try {
            const sourcePath = sourcePathPrefix || '';
            const format = (['zip', 'tar'].includes(outputFormat.toLowerCase()) ? outputFormat : 'zip');
            const streamArchiver = archiver(format);

            const outputFilePath = `${sourcePath}${outputFilename}.${format}`;
            const outputStream = new PassThrough();

            const params = {
                Bucket: sourceBucket,
                Key: outputFilePath,
                Body: outputStream,
                ...uploadOptions,
            };

            s3.upload(params, function(error, data) {
                if (error) {
                    reject(error);
                } else {
                    resolve({
                        s3Bucket: data.Bucket,
                        fileKey: data.Key,
                        fileSize: streamArchiver.pointer()
                    });
                }
            });

            streamArchiver.pipe(outputStream);

            if (sourceFiles && sourceFiles.length > 0) {
                sourceFiles = sourceFiles.map(file => `${sourcePath}${file}`);
            } else {
              var continuationToken = null
              while (true) {
                // Include all files in the S3 sourcePath in the archive if sourceFiles is empty
                const s3ObjectsProps = { Bucket: sourceBucket, ContinuationToken: continuationToken };

                if (sourcePath.length) s3ObjectsProps.Prefix = sourcePath;

                let s3Objects = await s3.listObjectsV2(s3ObjectsProps).promise();
                continuationToken = s3Objects.NextContinuationToken;
                sourceFiles = sourceFiles.concat(s3Objects.Contents.map(content => { return content.Key; }).filter(k => k != `${sourcePath}`));
                console.log(`Found ${sourceFiles.length} files in ${sourcePath}`);
                if (!s3Objects.IsTruncated) {
                    break;
                }
              }

              console.log(`Found ${sourceFiles.length} total files in ${sourcePath}`);
            }

            console.log('Working with source files:', sourceFiles);

            for (let s3File of sourceFiles) {
                let fileReadStream = s3.getObject({ Bucket: sourceBucket, Key: s3File }).createReadStream();
                const s3FileName = archiverOptions.s3FileNameTransform
                  ? archiverOptions.s3FileNameTransform(s3File)
                  : s3File.substring(s3File.lastIndexOf("/") + 1);

                streamArchiver.append(fileReadStream, { name: s3FileName })
            }

            streamArchiver.finalize();
        } catch (error) {
            reject(error);
        }
    });
};

module.exports.archive = archive;
