<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
require_once('./include/api-functions.php');
?>

<?php
global $current_user;
get_currentuserinfo();
$tempFile = $_FILES['file']['tmp_name'];

// If the file is not an upload file, this could be a malicious request
if (!is_uploaded_file($tempFile))
{
	echo 'Forbidden request';
	http_response_code(403);
	exit(1);
}
else if($current_user->ID < 0)
{
	echo 'User not logged in';
	http_response_code(401);
	exit(1);
}
else
{
	try
	{
		$featureID = intval($_POST['featureID']);
		$lon = NULL;
		$lat = NULL;
		$attribution = $_POST['attribution'];
		$description = $_POST['description'];
		$dateTaken = NULL;
		
		if ($_POST['dateTaken'] != 'null')
		{
			$dateTaken = date_create_from_format('d/m/Y', $_POST['dateTaken']);
			$dateTaken = date_format($dateTaken, 'Y-m-d');
		}
		
		if ($_POST['location'] != 'null')
		{
			$location = explode(',', $_POST['location']);
			$lon = floatval($location[0]);
			$lat = floatval($location[1]);
		}
		
		$tagString = $_POST['tags'];
		$tags = [];
		if (!is_null($tagString) && $tagString != '')
			$tags = explode(',', $tagString);
	}
	catch(Exception $e)
	{
		echo 'Invalid metadata parameters';
		http_response_code(400);
		exit(1);
	}
	
	$targetDirectory = '../../incident-media/' . $current_user->user_login;
	mkdir($targetDirectory);
	
	$mimeType = getMimeTypeFromFile($tempFile);
	$isImage = preg_match('/image\/[a-zA-Z0-9\-\/]*/', $mimeType);
	$isVideo = preg_match('/video\/[a-zA-Z0-9\-\/]*/', $mimeType);
	
	if (!$isImage && !$isVideo)
	{
		echo 'Unsupported file type';
		http_response_code(400);
		exit(1);
	}
	
	$targetFileName = pathinfo($_FILES['file']['name'], PATHINFO_FILENAME);
	
	// Replace any occurrences of '%' or '#' chars to prevent errors when requesting the image URL (double-escaping)
	$targetFileName = str_replace('%', '', $targetFileName);
	$targetFileName = str_replace('#', '', $targetFileName);
	$targetFileExt = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
	$targetFilePath = $targetDirectory . '/' . $targetFileName . '.' . $targetFileExt;
	$targetFileSize = $_FILES['file']['size'];
	
	if ($isImage)
	{
		$targetFilePathJpeg = $targetDirectory . '/' . $targetFileName . '.jpg';
		$targetFileExt = 'jpg';

		// If the file exists, append a unique suffix to the file path
		if (file_exists($targetFilePathJpeg))
		{
			$targetFileName = $targetFileName . '-' . uniqid();
			$targetFilePath = $targetDirectory . '/' . $targetFileName . '.' . $targetFileExt;
			$targetFilePathJpeg = $targetDirectory . '/' . $targetFileName . '.jpg';
		}
	}
	else if($isVideo)
	{
		if (file_exists($targetFilePath))
		{
			$targetFileName = $targetFileName . '-' . uniqid();
			$targetFilePath = $targetDirectory . '/' . $targetFileName . '.' . $targetFileExt;
		}
	}
	
	$relativePath = $current_user->user_login . '/' . $targetFileName . '.' . $targetFileExt;
	
	if (move_uploaded_file($tempFile, $targetFilePath))
	{
		if ($isImage)
		{
			if (!convertImageToJPEG($targetFilePath, $targetFilePathJpeg, 1920, 1080, 80))
			{
				echo 'Image conversion failed';
				http_response_code(500);
				exit(1);
			}
			
			$mimeType = getMimeTypeFromFile($targetFilePathJpeg);
			
			// Delete the source image if it was converted from a different format
			if ($targetFilePath != $targetFilePathJpeg)
				unlink($targetFilePath);
		}
		else
		{
			// No action, file was simply copied directly to the server
			$mimeType = getMimeTypeFromFile($targetFilePath);
		}
		
		// Pre-approve anything submitted by an admin or editor
		$isEditor = current_user_can('editor');
		$isAdmin = current_user_can('administrator');
		if ($isEditor || $isAdmin)
			$approvalStatus = 1;
		else
			$approvalStatus = -1;
		
		$query = $wpdb->prepare("CALL add_incident_media_file(%d, %d, %d, %s, %s, %s, %s, %d, %s, %s, %s, %d, %d)",
			$featureID, $lat, $lon, $targetFileName, $targetFileExt, $mimeType, $relativePath, $targetFileSize, $dateTaken,
			$attribution, $description, $current_user->ID, $approvalStatus);
		$recordID = $wpdb->get_var($query);
		
		// If no record ID retrieved, assume the query failed and remove the uploaded file
		if (!$recordID)
		{
			echo 'Failed to register metadata for file \'' . $targetFileName . '.' . $targetFileExt . '\'';
			http_response_code(500);
			unlink($targetFilePath);
			exit(1);
		}
		else
		{
			// Associate each tag with the media file
            $assignedTags = array();
			foreach ($tags as $tag)
			{
				$tagID = $wpdb->get_var($wpdb->prepare("CALL add_tag_to_media_file(%s, %d)", $tag, $recordID));
				array_push($assignedTags, array(
				    'ID' => intval($tagID),
                    'Name' => $tag
                ));
			}

			// Post the record to the ES index
            $indexName = 'avw_incident_media';
			$currentDateTime = date('Y-m-d\TH:i:s', current_time('timestamp'));
			$postData = array(
                'File_Name' => $targetFileName,
                'File_Ext' => $targetFileExt,
                'Mime_Type' => $mimeType,
                'Path' => $relativePath,
                'Size' => $targetFileSize,
                'Location' => array(
                    'lat' => $lat,
                    'lon' => $lon
                ),
                'Date_Taken' => $dateTaken,
                'Attribution' => $attribution,
                'Description' => $description,
                'Tags' => $assignedTags,
                'Created' => $currentDateTime,
                'Modified' => $currentDateTime,
                'Author' => array(
                    'ID' => $current_user->ID,
                    'Login' => $current_user->user_login,
                    'Name' => $current_user->display_name
                ),
                'Editor' => $current_user->ID,
                'Approval_Status' => $approvalStatus,
				'Likes' => []
            );

            $result = apiIndexPut($indexName, 'incident_media', $recordID, $postData);

            if (!$result)
            {
                echo 'Failed to post to index. Post data: ' . json_encode($postData);
                http_response_code(500);
                exit(1);
            }
            else
            {
                echo $recordID;
            }
		}
	}
	else
	{
		echo 'File could not be written';
		http_response_code(500);
		exit(1);
	}
}

/**
 * Returns a string-based MIME type for the specified file path
 */
function getMimeTypeFromFile($path)
{
	$mimeType = NULL;
	$finfo = finfo_open(FILEINFO_MIME);
	if ($finfo)
	{
		$mimeType = finfo_file($finfo, $path);
		finfo_close($finfo);
	}
	
	return $mimeType;
}

/**
 * Converts a source image to JPG format
 *
 * $originalImage - Path to the original image to convert
 * $outputImage - Output file path (if the same, will overwrite)
 * $maxDimensions - If length or width are greater than this, scales the image to fit
 * $quality - JPEG compression quality (0-100)
 *
 * Returns 1 if successful and 0 otherwise
 */
function convertImageToJPEG($originalImage, $outputImage, $maxWidth, $maxHeight, $quality)
{
    $ext = pathinfo($originalImage, PATHINFO_EXTENSION);

	$im = new Imagick($originalImage);
	$width = $im->getImageWidth();
	$height = $im->getImageHeight();
	
	autoRotateImage($im);
	
	if ($width > $maxWidth || $height > $maxHeight)
	{
		if ($width > $maxWidth)
			$width = $maxWidth;
		if ($height > $maxHeight)
			$height = $maxHeight;
			
		$im->scaleImage($width, $height, 1);
	}
	
	$im->setImageFormat('jpg');
	$im->setImageCompressionQuality($quality);
	
	$result = $im->writeImage($outputImage);
	
	$im->clear();
	$im->destroy();
	
	return $result;
}

/**
 * Rotates an image based on its EXIF rotational data.
 * 
 * $image - Imagick image object to be rotated
 *
 * Returns the result of the rotation: 1 if successful, 0 otherwise
 */
function autoRotateImage($image)
{ 
    $orientation = $image->getImageOrientation();
	$result = 0;
    switch($orientation)
	{ 
        case imagick::ORIENTATION_BOTTOMRIGHT: 
            $result = $image->rotateImage("#000", 180); // rotate 180 degrees 
        break; 

        case imagick::ORIENTATION_RIGHTTOP: 
            $result = $image->rotateImage("#000", 90); // rotate 90 degrees CW 
        break; 

        case imagick::ORIENTATION_LEFTBOTTOM: 
            $result = $image->rotateImage("#000", -90); // rotate 90 degrees CCW 
        break; 
    } 

    // Ensure the EXIF data reflects the image's new rotation
    $image->setImageOrientation(imagick::ORIENTATION_TOPLEFT); 
	
	return $result;
} 
?>