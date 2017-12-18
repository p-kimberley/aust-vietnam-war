<?php

/**
 * @param {string} $indexName
 * @param {string} $typeName
 * @param {Number} $id
 * @param {{}} $postJson
 * @return boolean
 */
function apiIndexPut($indexName, $typeName, $id, $postJson)
{
    $apiKey = "51886680-6898-4402-95DA-C048E0EEC930";
    $postData = json_encode($postJson);
    $request = curl_init(apiBaseUri() . '/api/es/index/' . $indexName . '/' . $typeName . '/' . $id . '?api_key=' . $apiKey);

    curl_setopt($request, CURLOPT_CUSTOMREQUEST, "PUT");
    curl_setopt($request, CURLOPT_POSTFIELDS, $postData);
    curl_setopt($request, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($request, CURLOPT_HTTPHEADER, array(
        'Content-Type: application/json',
        'Content-Length: ' . strlen($postData))
    );

    $result = curl_exec($request);
    curl_close($request);

    return $result;
}

/**
 * @param {string} $indexName
 * @param {string} $typeName
 * @param {Number} $id
 * @param {{}} $postJson
 * @return boolean
 */
function apiIndexUpdate($indexName, $typeName, $id, $postJson)
{
	$apiKey = "51886680-6898-4402-95DA-C048E0EEC930";
	$postData = json_encode($postJson);
	$request = curl_init(apiBaseUri() . '/api/es/update/' . $indexName . '/' . $typeName . '/' . $id . '?api_key=' . $apiKey);

	curl_setopt($request, CURLOPT_CUSTOMREQUEST, "POST");
	curl_setopt($request, CURLOPT_POSTFIELDS, $postData);
	curl_setopt($request, CURLOPT_RETURNTRANSFER, true);
	curl_setopt($request, CURLOPT_HTTPHEADER, array(
			'Content-Type: application/json',
			'Content-Length: ' . strlen($postData))
	);

	$result = curl_exec($request);
	curl_close($request);

	return $result;
}

/**
 * @return string The base URI of the site
 */
function apiBaseUri()
{
	return "http://localhost";
    /*return sprintf(
        "%s://%s",
        isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] != 'off' ? 'https' : 'http',
        $_SERVER['SERVER_NAME']);*/
}